import * as vscode from 'vscode';
import { Uri, ViewColumn, Webview } from 'vscode';
import { AnyFile, Directory, Connection, VisualizationSettings } from "./shared";
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
        settings: Partial<VisualizationSettings> = {},
        connections: Iterable<Connection> = []
    ) {
        this.context = context;
        const defaultSettings = {
            title: 'CodeBase Relationship Visualizer',
        };
        this.settings = { ...defaultSettings, ...settings };
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
            this.settings.title,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.file(this.context.extensionPath)],
            }
        );

        panel.webview.onDidReceiveMessage(message => {
                if (message.type == "ready") {
                    panel.webview.postMessage({
                        type: "set",
                        codebase: this.codebase,
                        settings: this.settings,
                        connections: this.connections,
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
            <body style="overflow: hidden">
                <svg id="canvas" style="max-width: 100%; max-height: 99vh"></svg>
                <script>var exports = {}</script>
                <script src="${scriptUri}"></script>
            </body>
            </html>
        `;
    }
}


