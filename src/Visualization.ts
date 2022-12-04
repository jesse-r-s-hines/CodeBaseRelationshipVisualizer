import * as vscode from 'vscode';
import { workspace } from "vscode";
import { Uri, Webview, WebviewPanel, FileSystemWatcher } from 'vscode';
import { Connection, NormalizedConnection, VisualizationSettings } from "./publicTypes";
import { WebviewVisualizationSettings, CBRVMessage, Directory } from "./privateTypes";

import { DeepRequired } from "ts-essentials";
import _, { isEqual, cloneDeep } from 'lodash';
import * as fileHelper from "./fileHelper";

type VisualizationState = InstanceType<typeof Visualization.VisualizationState>;

/**
 * Handles the visualization, allowing you to update the visualization.
 */
export class Visualization {
    private context: vscode.ExtensionContext;
    private readonly codebase: Uri
    private originalSettings: VisualizationSettings;
    private settings: DeepRequired<VisualizationSettings>
    private connections: Connection[] = []

    private webviewPanel?: WebviewPanel
    private fsWatcher?: FileSystemWatcher

    private include = "**/*"
    private exclude = ""
    private files: Uri[] = [];

    private onFSChangeCallback?: (visState: VisualizationState) => Promise<void>

    private static readonly defaultSettings: DeepRequired<VisualizationSettings> = {
        title: 'CodeBase Relationship Visualizer',
        directed: false,
        showOnHover: false,
        connectionDefaults: {
            width: 2,
            color: 'yellow',
            tooltip: (conn) => conn.tooltip,
        },
        mergeRules: {
            file: "ignore",
            line: "ignore",
            direction: "ignore",
            width: { rule: "add", max: 4 },
            color: "mostCommon",
            tooltip: { rule: "join", sep: "<br/>" },
        },
    };

    constructor(
        context: vscode.ExtensionContext,
        codebase: Uri,
        settings: VisualizationSettings = {},
    ) {
        this.context = context;
        this.originalSettings = settings;
        this.settings = this.normalizeSettings(settings);
        this.codebase = codebase;
    }

    /** A mutable "view" on a Visualization */
    static VisualizationState = class {
        private visualization: Visualization

        settings: VisualizationSettings
        connections: Connection[]
        
        constructor(visualization: Visualization) {
            this.visualization = visualization;
            this.settings = cloneDeep(this.visualization.originalSettings);
            this.connections = cloneDeep(this.visualization.connections);
        }

        /** The root of the codebase we are visualizing */
        get codebase(): Uri { return this.visualization.codebase; }

        /** Get a list of all the files included by the current include/exclude settings. */
        get files(): Uri[] { return this.visualization.files; }

        // /** TODO
        // * Return connections that are connected to the given file. Optionally
        // * specify the direction the are going relative to the file.
        // */
        // getConnected(file: Uri, direction?: Direction): Connection[]
    }

    /**
     * Used to update the visualization. Update the state in the callback and the visualization will update after
     * calling the callback.
     */
    async update(func: (visState: VisualizationState) => Promise<void>): Promise<void> {
        const state = new Visualization.VisualizationState(this);
        await func(state); // user can mutate settings and connections in here
        
        const send = {settings: false, connections: false};

        if (!isEqual(this.originalSettings, state.settings)) {
            this.originalSettings = state.settings;
            this.settings = this.normalizeSettings(state.settings);
            if (this.webviewPanel) {
                this.webviewPanel.title == this.settings.title;
            }
            send.settings = true;
        }

        if (!isEqual(this.connections, state.connections)) {
            this.connections = state.connections;
            send.connections = true;
        }

        await this.sendSet(send);
    }

    /**
     * Set the callback to update the visualization whenever the files change. Shortcut for setting up a custom
     * FileSystemWatcher on the codebase that calls `Visualization.update`.
     * 
     * You can pass `{immediate: true}` if you want it to trigger immediately as well.
     */
    onFSChange(func: (visState: VisualizationState) => Promise<void>, options?: {immediate?: boolean}): void {
        this.onFSChangeCallback = func;
        if (options?.immediate ?? false) {
            this.update(this.onFSChangeCallback);
        }
    }


    /**
     * These properties and methods are just passed through to the internal webview panel.
     * See https://code.visualstudio.com/api/references/vscode-api#WebviewPanel
     */
    get active() { return this.webviewPanel!.active; }
    get viewColumn() { return this.webviewPanel!.viewColumn; }
    get visible() { return this.webviewPanel!.visible; }
    reveal(viewColumn?: vscode.ViewColumn, preserveFocus?: boolean): void {
        this.webviewPanel!.reveal(viewColumn, preserveFocus);
    }

    async launch() {
        if (this.webviewPanel) {
            throw new Error("Visualization launched twice");
        }
        this.webviewPanel = this.createWebviewPanel();

        // Await until we get the ready message from the webview
        await new Promise((resolve, reject) => {
            const disposable = this.webviewPanel!.webview.onDidReceiveMessage(
                async (message: CBRVMessage) => {
                    if (message.type == "ready") {
                        disposable.dispose();
                        resolve(undefined);
                    } else {
                        reject(new Error('First message should be "ready"'));
                    }
                }
            );
        });

        await this.updateFileList();
        await this.sendSet({codebase: true, settings: true, connections: true});
        this.setupWatcher();

        this.webviewPanel.webview.onDidReceiveMessage(
            async (message: CBRVMessage) => {
                if (message.type == "ready") { // we can get ready again if the webview closes and reopens.
                    await this.sendSet({codebase: true, settings: true, connections: true});
                } else if (message.type == "filter") {
                    this.include = message.include;
                    this.exclude = message.exclude;
                    await this.sendSet({codebase: true});
                } else if (message.type == "open") {
                    // NOTE: we could do these and Command URIs inside the webview instead. That might be simpler
                    await vscode.commands.executeCommand("vscode.open", this.getUri(message.file));
                } else if (message.type == "reveal-in-explorer") {
                    await vscode.commands.executeCommand("revealInExplorer", this.getUri(message.file));
                } else if (message.type == "copy-path") {
                    vscode.env.clipboard.writeText(this.getUri(message.file).fsPath);
                } else if (message.type == "copy-relative-path") {
                    vscode.env.clipboard.writeText(message.file);
                } else if (message.type == "tooltip-request") {
                    await this.send({
                        type: "tooltip-set",
                        id: message.id,
                        content: this.settings.connectionDefaults.tooltip(message.conn) || "",
                    });
                }
            },
            undefined,
            this.context.subscriptions
        );
    }

    /** Destroy the visualization and all webviews/watchers etc. */
    dispose(): void {
        this.webviewPanel?.dispose();
        this.fsWatcher?.dispose();
    }

    /**
     * Updates stuff after the codebase or include/exclude settings have changed.
     */
    private async updateFileList(): Promise<void> {
        this.files = await fileHelper.getFilteredFileList(this.codebase, this.include, this.exclude);
    }

    /** Returns a complete settings object with defaults filled in an normalized a bit.  */
    private normalizeSettings(settings: VisualizationSettings): DeepRequired<VisualizationSettings> {
        settings = cloneDeep(settings);
        if (settings.mergeRules === true) {
            settings.mergeRules = {}; // just use all the defaults
        }
        if (settings.showOnHover === true) {
            settings.showOnHover = "both";
        }

        settings = _.merge({}, Visualization.defaultSettings, settings);

        return settings as DeepRequired<VisualizationSettings>;
    }

    private setupWatcher() {
        // TODO VSCode watcher may be ignoring some file trees like node_modules by default.
        this.fsWatcher = workspace.createFileSystemWatcher(
            // Watch entire codebase. The workspace is watched by default, so it shouldn't be a performance
            // issue to add a broad watcher for it since it will just use the default watcher. We'll check
            // include/exclude the callback.
            new vscode.RelativePattern(this.codebase, '**/*')
        );

        const callback = async () => {
            await this.sendSet({codebase: true});
            if (this.onFSChangeCallback) {
                this.update(this.onFSChangeCallback);
            }
        };

        const inFiles = (uri: Uri) => this.files.some(u => u.fsPath == uri.fsPath);

        this.fsWatcher.onDidChange(async uri => {
            if (inFiles(uri)) {
                await callback();
                // don't need to update file list
            }
        });
        this.fsWatcher.onDidCreate(async uri => {
            await this.updateFileList();
            if (inFiles(uri)) {
                callback(); // check if in new file list
            }
        });
        this.fsWatcher.onDidDelete(async uri => {
            if (inFiles(uri)) { // check if in original file list
                await this.updateFileList();
                callback();
            }
        });
        // this.fsWatcher.dispose(); // TODO dispose after usage
    }

    private createWebviewPanel(): WebviewPanel {
        // Create and show panel
        const panel = vscode.window.createWebviewPanel(
            'codeBaseRelationshipVisualizer',
            this.settings.title,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.file(this.context.extensionPath)],
                // enableCommandUris: true,
            }
        );

        panel.webview.html = this.getWebviewContent(panel.webview);

        return panel;
    }

    private getWebviewContent(webview: Webview): string {
        const extPath = vscode.Uri.file(this.context.extensionPath);
        const scriptUri = webview.asWebviewUri(Uri.joinPath(extPath, "dist", "webview", "webview.js"));
        const stylesUri = webview.asWebviewUri(Uri.joinPath(extPath, "src", "webview", "CBRVStyles.css"));

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>CodeBase Relationship Visualizer</title>
                <link rel="stylesheet" href="${stylesUri}">
            </head>
            <body>
                <div id="filters">
                    <div class="form-input">
                        <label for="include">Files to include</label>
                        <input id="include" title="e.g. *.ts, src/**/include"></input>
                    </div>
                    <div class="form-input">
                        <label for="exclude">File to exclude</label>
                        <input id="exclude" title="e.g. *.ts, src/**/include"></input>
                    </div>
                    <div class="form-input">
                        <label for="hide-unconnected">Hide Unconnected</label>
                        <input id="hide-unconnected" type="checkbox"></input>
                    </div>
                </div>
                <svg id="diagram"></svg>
                <script>var exports = {}</script>
                <script src="${scriptUri}"></script>
            </body>
            </html>
        `;
    }

    private async sendSet(send: {codebase?: boolean, settings?: boolean, connections?: boolean}) {
        let codebase: Directory|undefined;
        if (send.codebase) {
            codebase = await fileHelper.listToFileTree(this.codebase, this.files);
        }

        let settings: WebviewVisualizationSettings|undefined;
        if (send.settings) {
            settings = _.omit(this.settings, ["title", "connectionDefaults.tooltip"]) as WebviewVisualizationSettings;
        }

        let connections: NormalizedConnection[]|undefined;
        if (send.connections) {
            connections = this.connections?.map(conn => {
                if (!conn.from && !conn.to) {
                    throw Error("Connections must have at least one of from or to defined");
                }
                return { // TODO normalize file paths as well
                    ...conn,
                    from: (typeof conn.from == 'string') ? {file: conn.from} : conn.from,
                    to: (typeof conn.to == 'string') ? {file: conn.to} : conn.to,
                };
            });
        }

        await this.send({ type: "set", settings, codebase, connections });
    }
    
    private async send(message: CBRVMessage) {
        await this.webviewPanel!.webview.postMessage(message);
    }

    private getUri(file: string): Uri {
        return vscode.Uri.file(`${this.codebase.fsPath}/${file}`);
    }
}



