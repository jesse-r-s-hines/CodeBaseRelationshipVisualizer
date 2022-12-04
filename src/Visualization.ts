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
    private onFSChangeCallbackImmediate?: boolean

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
        this.originalSettings = this.settings = undefined as any; // just to silence typescript "not initialized" errors
        this.updateSettings(settings); // sets originalSettings and settings
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
            send.settings = true;
            this.updateSettings(state.settings);
        }

        if (!isEqual(this.connections, state.connections)) {
            send.connections = true;
            this.connections = state.connections;
        }

        await this.sendUpdate(send);
    }

    /**
     * Set the callback to update the visualization whenever the files change. Shortcut for setting up a custom
     * FileSystemWatcher on the codebase that calls `Visualization.update`.
     * 
     * You can pass `initial = true` if you want it to trigger on initial creation of the visualization as well.
     */
    onFSChange(func: (visState: VisualizationState) => Promise<void>, options?: {immediate?: boolean}): void {
        this.onFSChangeCallback = func;
        this.onFSChangeCallbackImmediate = options?.immediate ?? false;
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
    dispose(): any {
        return this.webviewPanel!.dispose();
    }


    async launch() {
        if (this.webviewPanel) {
            throw new Error("Visualization launched twice");
        }
        this.webviewPanel = this.createWebviewPanel();

        this.webviewPanel.webview.onDidReceiveMessage(
            async (message: CBRVMessage) => {
                if (message.type == "ready") {
                    await this.sendUpdate({codebase: true, settings: true, connections: true});
                    if (this.onFSChangeCallback && this.onFSChangeCallbackImmediate) {
                        this.update(this.onFSChangeCallback);
                    }

                    this.fsWatcher = workspace.createFileSystemWatcher(
                        // TODO this should use excludes
                        new vscode.RelativePattern(this.codebase, '**/*')
                    );

                    const callback = async (uri: Uri) => {
                        await this.sendUpdate({codebase: true});
                        if (this.onFSChangeCallback) {
                            this.update(this.onFSChangeCallback);
                        }
                    };

                    // TODO might have issues with using default excludes?
                    // TODO send only changes? Likely use a merge-throttle pattern to clump multiple changes.
                    this.fsWatcher.onDidChange(callback);
                    this.fsWatcher.onDidCreate(callback);
                    this.fsWatcher.onDidDelete(callback);
                    // this.fsWatcher.dispose(); // TODO dispose after usage
                } else if (message.type == "filter") {
                    this.include = message.include;
                    this.exclude = message.exclude;
                    await this.sendUpdate({codebase: true});
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

    private updateSettings(settings: VisualizationSettings) {
        this.originalSettings = settings;
        settings = cloneDeep(settings);
        if (settings.mergeRules === true) {
            settings.mergeRules = {}; // just use all the defaults
        }
        if (settings.showOnHover === true) {
            settings.showOnHover = "both";
        }

        this.settings = _.merge({}, Visualization.defaultSettings, settings);

        if (this.webviewPanel) {
            this.webviewPanel.title == this.settings.title;
        }
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

    private async sendUpdate(send: {codebase?: boolean, settings?: boolean, connections?: boolean}) {
        let codebase: Directory|undefined;
        if (send.codebase) {
            this.files = await fileHelper.getFilteredFileList(this.codebase, this.include, this.exclude);
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



