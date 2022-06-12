import * as vscode from 'vscode';
import { workspace, Uri, Webview } from 'vscode';
import * as path from 'path';
import { AnyFile, FileType } from "./util";

export function activate(context: vscode.ExtensionContext) {
    console.log("CodeBase Relationship Visualizer active");

    context.subscriptions.push(
        vscode.commands.registerCommand('codeBaseRelationshipVisualizer.start', async () => {
            const folder = await getWorkspaceFileTree();

            if (folder) {
                // Create and show panel
                const panel = vscode.window.createWebviewPanel(
                    'codeBaseRelationshipVisualizer',
                    'CodeBase Relationship Visualizer',
                    vscode.ViewColumn.One,
                    {
                        enableScripts: true,
                        localResourceRoots: [vscode.Uri.file(context.extensionPath)],
                    }
                );

                panel.webview.html = getWebviewContent(context, panel.webview);

                panel.webview.postMessage({ type: "set-codebase", folder: folder });
            } else {
                // TODO: no workspace
            }
        })
    );
}

async function getWorkspaceFileTree(): Promise<AnyFile | undefined> {
    if (vscode.workspace.workspaceFolders !== undefined) {
        const base = vscode.workspace.workspaceFolders[0].uri;
        return await getFileTree(base, FileType.Directory);
    } else {
        return undefined;
    }
}

async function getFileTree(uri: Uri, type: FileType): Promise<AnyFile> {
    const name = path.basename(uri.fsPath);
    if (type == FileType.Directory) {
        const files = await workspace.fs.readDirectory(uri);
        const children = await Promise.all(files.map(([name, type]) => getFileTree(Uri.joinPath(uri, name), type)));
        return { type, name, children: children };
    } else if (type == FileType.File) {
        return { type, name, size: (await workspace.fs.stat(uri)).size || 1 };
    } else {
        throw new Error("Other file types not supported"); // TODO handle symlinks and other special files
    }
}

function getWebviewContent(context: vscode.ExtensionContext, webview: Webview) {
    const extPath = vscode.Uri.file(context.extensionPath);
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
            <div id="canvas"></div>
            <script>var exports = {}</script>
            <script src="${scriptUri}"></script>
        </body>
        </html>
    `;
}
