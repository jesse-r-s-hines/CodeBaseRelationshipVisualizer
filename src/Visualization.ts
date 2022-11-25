import * as vscode from 'vscode';
import { workspace } from "vscode";
import { Uri, Webview, WebviewPanel, FileSystemWatcher } from 'vscode';
import { Connection, NormalizedConnection, VisualizationSettings } from "./publicTypes";
import { WebviewVisualizationSettings, CBRVMessage } from "./privateTypes";

import { DeepRequired } from "ts-essentials";
import _ from 'lodash';
import * as fileHelper from "./fileHelper";

/**
 * Handles the visualization, allowing you to update the visualization.
 */
export class Visualization {
    private context: vscode.ExtensionContext;
    private settings: DeepRequired<VisualizationSettings>
    private codebase: Uri
    private connections: Connection[]

    private webviewPanel?: WebviewPanel
    private fsWatcher?: FileSystemWatcher

    private include = "**/*"
    private exclude = ""
    private files: Uri[] = [];

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
        connections: Iterable<Connection> = []
    ) {
        this.context = context;
        settings = _.cloneDeep(settings);
        if (settings.mergeRules === true) {
            settings.mergeRules = {}; // just use all the defaults
        }
        if (settings.showOnHover === true) {
            settings.showOnHover = "both";
        }

        this.settings = _.merge({}, Visualization.defaultSettings, settings);
        this.codebase = codebase;
        this.connections = [...connections];
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
                    await this.sendUpdate(true, this.getWebviewSettings(), this.connections);
                    this.fsWatcher = workspace.createFileSystemWatcher(
                        // TODO this should use excludes
                        new vscode.RelativePattern(this.codebase, '**/*')
                    );

                    // TODO might have issues with using default excludes?
                    // TODO send only changes? Likely use a merge-throttle pattern to clump multiple changes.
                    this.fsWatcher.onDidChange(uri => this.sendUpdate(true));
                    this.fsWatcher.onDidCreate(uri => this.sendUpdate(true));
                    this.fsWatcher.onDidDelete(uri => this.sendUpdate(true));
                    // this.fsWatcher.dispose(); // TODO dispose after usage
                } else if (message.type == "filter") {
                    this.include = message.include;
                    this.exclude = message.exclude;
                    await this.sendUpdate(true);
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

    private getWebviewSettings(): WebviewVisualizationSettings {
        return _.omit(this.settings, ["title", "connectionDefaults.tooltip"]) as WebviewVisualizationSettings;
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

    private async sendUpdate(getCodebase: boolean, settings?: WebviewVisualizationSettings, connections?: Connection[]) {
        let codebase = undefined;
        if (getCodebase) {
            this.files = await fileHelper.getFilteredFileList(this.codebase, this.include, this.exclude);
            codebase = await fileHelper.listToFileTree(this.codebase, this.files);
        }
        const normConns: NormalizedConnection[]|undefined = connections?.map(conn => {
            if (!conn.from && !conn.to) {
                throw Error("Connections must have at least one of from or to defined");
            }
            return { // TODO normalize file paths as well
                ...conn,
                from: (typeof conn.from == 'string') ? {file: conn.from} : conn.from,
                to: (typeof conn.to == 'string') ? {file: conn.to} : conn.to,
            };
        });
    
        await this.send({
            type: "set",
            settings: settings,
            codebase: codebase,
            connections: normConns,
        });
    }
    
    private async send(message: CBRVMessage) {
        await this.webviewPanel!.webview.postMessage(message);
    }

    private getUri(file: string): Uri {
        return vscode.Uri.file(`${this.codebase.fsPath}/${file}`);
    }
}


