import * as vscode from 'vscode';
import { Uri, ViewColumn, Webview } from 'vscode';
import { AnyFile, Directory } from "./util";
import * as fileHelper from "./fileHelper";

/**
 * Handles the visualization, allowing you to update the visualization.
 */
export class Visualization {
    private context: vscode.ExtensionContext;
    private settings: VisualizationSettings 
    private connections: Connection[]

    private codebase?: Directory
    private webview?: vscode.Webview

    constructor(
        context: vscode.ExtensionContext,
        settings: VisualizationSettings = {},
        connections: Iterable<Connection> = []
    ) {
        this.context = context;
        this.settings = settings;
        this.connections = [...connections];
    }

    async launch() {
        this.codebase = await fileHelper.getWorkspaceFileTree();
        if (this.codebase) {
            this.webview = this.createWebview();
        } else {
            throw new Error("No workspace to visualize");
        }
    }

    private createWebview(): Webview {
        // Create and show panel
        const panel = vscode.window.createWebviewPanel(
            'codeBaseRelationshipVisualizer',
            'CodeBase Relationship Visualizer',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.file(this.context.extensionPath)],
            }
        );

        panel.webview.onDidReceiveMessage(message => {
                if (message.type == "ready") {
                    panel.webview.postMessage({
                        type: "set-codebase",
                        codebase: this.codebase
                    });
                }
            },  
            undefined,
            this.context.subscriptions
        );

        panel.webview.html = this.getWebviewContent(panel.webview);

        return panel.webview;
    }

    private getWebviewContent(webview: Webview): string {
        const extPath = vscode.Uri.file(this.context.extensionPath);
        const scriptUri = webview.asWebviewUri(Uri.joinPath(extPath, "dist", "webview", "webview.js"));

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>CodeBase Relationship Visualizer</title>
            </head>
            <body>
                <svg id="canvas" style="max-width: 100%"></svg>
                <script>var exports = {}</script>
                <script src="${scriptUri}"></script>
            </body>
            </html>
        `;
    }
}

/**
 * Settings and configuration for a Visualization.
 * TODO can we make this an "inner class"?
 */
 export interface VisualizationSettings {
    /**
     * Title for the internal webview. See https://code.visualstudio.com/api/references/vscode-api#WebviewPanel
     */
    title?: string
}

/**
 * Represents a connection or relationship between files. A `Connection` connects two file:line locations in the
 * workspace. `Connections` will be rendered as a line or arrow in the visualization. `line` is optional, in which case
 * the `Connection` will just connect the files and can be passed just the file `Uri`. `Connections` can be between two
 * different files, different lines in the same file, or even connect a file to itself. `Connections` can only connect
 * files, not folders. If `from` or `to` is undefined, the connection will start or end "outside" the visualization.
 * 
 * E.g.
 * ```ts
 * {
 *   from: {file: Uri.file("main.py"), line: 10},
 *   to: {file: Uri.file("tutorial.py"), line: 3}
 * }
 * ```
 * or
 * ```ts
 * {
 *   from: Uri.file("main.py"),
 *   to: Uri.file("tutorial.py")
 * }
 * ```
 */
export interface Connection {
    from: Endpoint
    to: Endpoint
}

/**
 * Represents one endpoint of a `Connection`. Can be `Uri` to the file or an object containing a `Uri` and an optional
 * line number.
 */
export type Endpoint = Uri | { file: Uri, line?: number }
