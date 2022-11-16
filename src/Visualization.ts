import * as vscode from 'vscode';
import { workspace } from "vscode"
import { Uri, Webview, FileSystemWatcher } from 'vscode';
import { Connection, VisualizationSettings, NormalizedVisualizationSettings, CBRVMessage } from "./shared";
import * as fileHelper from "./fileHelper";
import _ from 'lodash'

/**
 * Handles the visualization, allowing you to update the visualization.
 */
export class Visualization {
    private context: vscode.ExtensionContext;
    private settings: NormalizedVisualizationSettings
    private connections: Connection[]

    private webview?: vscode.Webview
    private fsWatcher?: FileSystemWatcher

    private static readonly defaultSettings: NormalizedVisualizationSettings = {
        title: 'CodeBase Relationship Visualizer',
        directed: false,
        showOnHover: false,
        connectionDefaults: {
            width: 2,
            color: 'yellow',
        },
        mergeRules: {
            file: "ignore",
            line: "ignore",
            direction: "ignore",
            width: { rule: "add", max: 4 },
            color: "mostCommon",
        },
    };

    constructor(
        context: vscode.ExtensionContext,
        settings: VisualizationSettings = {},
        connections: Iterable<Connection> = []
    ) {
        this.context = context;
        settings = _.cloneDeep(settings)
        if (settings.mergeRules === true) {
            settings.mergeRules = {} // just use all the defaults
        }
        if (settings.showOnHover === true) {
            settings.showOnHover = "both"
        }

        this.settings = _.merge({}, Visualization.defaultSettings, settings)
        this.connections = [...connections];
    }

    async launch() {
        this.webview = this.createWebview();

        this.webview.onDidReceiveMessage(
            async (message: CBRVMessage) => {
                if (message.type == "ready") {
                    this.send(true, this.settings, this.connections);
                    this.fsWatcher = workspace.createFileSystemWatcher(
                        // TODO this should use excludes
                        new vscode.RelativePattern(workspace.workspaceFolders![0], '**/*')
                    );

                    // TODO might have issues with using default excludes?
                    // TODO send only changes? Likely use a merge-throttle pattern to clump multiple changes.
                    this.fsWatcher.onDidChange(uri => this.send(true));
                    this.fsWatcher.onDidCreate(uri => this.send(true));
                    this.fsWatcher.onDidDelete(uri => this.send(true));
                    // this.fsWatcher.dispose(); // TODO dispose after usage
                } else if (message.type == "open") {
                    // NOTE: we could do these and Command URIs inside the webview instead. That might be simpler,
                    // but would require sending the full path into the webview.
                    const path = vscode.Uri.file(`${workspace.workspaceFolders![0]!.uri.fsPath}/${message.file}`)
                    await vscode.commands.executeCommand("vscode.open", path)
                } else if (message.type == "reveal-in-explorer") {
                    const path = vscode.Uri.file(`${workspace.workspaceFolders![0]!.uri.fsPath}/${message.file}`)
                    await vscode.commands.executeCommand("revealInExplorer", path)
                }
            },
            undefined,
            this.context.subscriptions
        );
    }

    private createWebview(): Webview {
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

        return panel.webview;
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
                <svg id="canvas"></svg>
                <script>var exports = {}</script>
                <script src="${scriptUri}"></script>
            </body>
            </html>
        `;
    }

    private async send(getCodebase: boolean, settings?: VisualizationSettings, connections?: Connection[]) {
        let codebase = undefined;
        if (getCodebase) {
            codebase = await fileHelper.getWorkspaceFileTree();
            if (!codebase) throw new Error("No workspace to visualize");
        }

        this.webview!.postMessage({
            type: "set",
            settings: settings,
            codebase: codebase,
            connections: connections,
        });
    }
}


