import * as vscode from 'vscode';
import { workspace, Uri, Webview, FileType } from 'vscode';
import * as path from 'path';
import { AnyFile } from "./shared";
import { Visualization } from "./Visualization";

export function activate(context: vscode.ExtensionContext) {
    console.log("CodeBase Relationship Visualizer active");

    context.subscriptions.push(
        vscode.commands.registerCommand('codeBaseRelationshipVisualizer.start', async () => {
            const visualization = new Visualization(context, {}, [
                { from: "A/E.txt", to: "A/F.txt" },
            ]);
            await visualization.launch();
        }),
    );

    // TODO: Remove this. Launching automatically for convenience during testing. Also remove "*" activationEvent.
    vscode.commands.executeCommand('codeBaseRelationshipVisualizer.start');
}

