import * as vscode from 'vscode';
import {workspace, DebugAdapterTracker, DebugSession, Uri, FileType, SourceBreakpoint, Location, Range, Position} from 'vscode'
import {DebugProtocol} from 'vscode-debugprotocol'
import * as path from 'path';

interface FileTree {
    type: FileType
    name: string
    children?: FileTree[]
    size?: number
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function activate(context: vscode.ExtensionContext) {
    console.log("Code Structure Visualization active")
    // vscode.debug.registerDebugAdapterTrackerFactory("*", new MyDebugAdapterTrackerFactory())

    context.subscriptions.push(
        vscode.commands.registerCommand('codeStructureVisualization.start', async () => {
            let session = vscode.debug.activeDebugSession
            if (session) {
                let folder = (await getWorkspaceFileTree())!
                function flatten(file: FileTree, parentPath: string = ""): string[] {
                    let filePath = path.join(parentPath, file.name)
                    if (file.children) {
                        return ([] as string[]).concat(...file.children.map(f => flatten(f, filePath)))
                    } else {
                        return [filePath]
                    }
                }
                let workspacePath = workspace.workspaceFolders![0].uri;

                let files = flatten(folder).filter(f => f.endsWith(".py")).map(
                    f => Uri.joinPath(workspacePath, f.replace(`${folder.name}/`, ""))
                )
                let fileBreakpoints: {[file: string]: SourceBreakpoint[]} = {}
                for (let file of files) {
                    let lines = (await workspace.openTextDocument(file)).getText().split("\n")
                    fileBreakpoints[file.fsPath] =  [...Array(lines.length).keys()].map(i =>
                        new SourceBreakpoint(new Location(file, new Position(i, 0))
                    ))
                    // fileBreakpoints[file.fsPath] = [new SourceBreakpoint(new Location(file, new Range(
                    //     new Position(0, 0), new Position(lines.length - 1, lines[lines.length - 1].length - 1))
                    // ))]
                }

                let threadId = (await session.customRequest('threads')).threads[0].id

                while (true) {
                    let stackFrames: DebugProtocol.StackFrame[] = (await session.customRequest("stackTrace", { threadId: threadId })).stackFrames;
                    let currentFile = stackFrames[stackFrames.length - 1].source!.path!
                    
                    for (let file of files) {
                        let breakpoints = currentFile == file.fsPath ? [] : fileBreakpoints[file.fsPath]
                        vscode.debug.addBreakpoints(breakpoints)
                    }

                    await session.customRequest("continue", { threadId: threadId })
                    await sleep(4000)
                }
            }

            // // Create and show panel
            // const panel = vscode.window.createWebviewPanel(
            //     'codeStructureVisualization',
            //     'Code Structure Visualization',
            //     vscode.ViewColumn.One,
            //     {
            //       enableScripts: true
            //     }
            // );

            // And set its HTML content
            // let folder = await getWorkspaceFileTree()
            // let extPath = vscode.Uri.file(context.extensionPath)
            // const jsonUri = Uri.joinPath(extPath, "src", "sample.json");
            // let folder = JSON.parse((await vscode.workspace.openTextDocument(jsonUri)).getText()) as FileTree;

            // if (folder) {
            //     panel.webview.html = getWebviewContent(folder, context);
            // } else {
            //     // no workspace
            // }
        })
    );
}

class MyDebugAdapterTrackerFactory implements vscode.DebugAdapterTrackerFactory {
    createDebugAdapterTracker(session: DebugSession): DebugAdapterTracker {
        return {
            async onDidSendMessage(msg: DebugProtocol.ProtocolMessage) {
                if (msg.type == "event" && (msg as DebugProtocol.Event).event == "stopped") {
                    let stoppedMsg = msg as DebugProtocol.StoppedEvent
                    const threadId = stoppedMsg.body.threadId
                    let reply = await session.customRequest("stackTrace", {
                        threadId: threadId,
                    }) as DebugProtocol.StackTraceResponse;
                    console.log(reply)
                }
            }
        }
    }
}

async function getWorkspaceFileTree(): Promise<FileTree|undefined> {
    if(vscode.workspace.workspaceFolders !== undefined) {
        let base = vscode.workspace.workspaceFolders[0].uri;
        return await getFileTree(base, FileType.Directory)
    } else {
        return undefined
    }
}

async function getFileTree(uri: Uri, type: FileType): Promise<FileTree> {
    let rtrn = {
        type: type,
        name: path.basename(uri.fsPath),
    }
    if (type == FileType.Directory) {
        let files = await workspace.fs.readDirectory(uri)
        let children = await Promise.all(files.map(([name, type]) => getFileTree(Uri.joinPath(uri, name), type)))
        return {...rtrn, children: children}
    } else {
        return {...rtrn, size: (await workspace.fs.stat(uri)).size || 1}
    }
}

function getWebviewContent(folder: FileTree, context: vscode.ExtensionContext) {
    let extPath = vscode.Uri.file(context.extensionPath)
    const scriptUri = Uri.joinPath(extPath, "src", "diagram.js").with({ 'scheme': 'vscode-resource' });

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Circle</title>
            <script src="https://d3js.org/d3.v7.min.js"></script>
            <script src="https://d3js.org/d3-selection-multi.v1.min.js"></script>
        </head>
        <body>
            <div id="canvas"></div>
            <script>
                window.folder = ${JSON.stringify(folder)}
            </script>
            <script src="${scriptUri}"/>
        </body>
        </html>
  `  
}