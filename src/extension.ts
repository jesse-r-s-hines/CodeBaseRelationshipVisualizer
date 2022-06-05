import * as vscode from 'vscode';
import {workspace, Uri, FileType} from 'vscode';
import * as path from 'path';
import { FileTree } from "./util";

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

                panel.webview.html = getWebviewContent(context);

                panel.webview.postMessage({ type: "update-folder", folder: folder });
            } else {
                // no workspace
            }
        })
    );
}

async function getWorkspaceFileTree(): Promise<FileTree|undefined> {
    if(vscode.workspace.workspaceFolders !== undefined) {
        const base = vscode.workspace.workspaceFolders[0].uri;
        return await getFileTree(base, FileType.Directory);
    } else {
        return undefined;
    }
}

async function getFileTree(uri: Uri, type: FileType): Promise<FileTree> {
    const rtrn = {
        type: type,
        name: path.basename(uri.fsPath),
    };
    if (type == FileType.Directory) {
        const files = await workspace.fs.readDirectory(uri);
        const children = await Promise.all(files.map(([name, type]) => getFileTree(Uri.joinPath(uri, name), type)));
        return {...rtrn, children: children};
    } else {
        return {...rtrn, size: (await workspace.fs.stat(uri)).size || 1};
    }
}

function getWebviewContent(context: vscode.ExtensionContext) {
    const extPath = vscode.Uri.file(context.extensionPath);
    const scriptUri = Uri.joinPath(extPath, "out", "webview", "webview.js").with({ 'scheme': 'vscode-resource' }); // TODO asWebviewUri

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Circle</title>
        </head>
        <body>
            <div id="canvas"></div>
            <script>var exports = {}</script>
            <script src="${scriptUri}"/>
        </body>
        </html>
  `;
}
