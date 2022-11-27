import * as vscode from 'vscode';
import { API } from "./api";
import { visualizeHyperlinkGraph } from "./hyperlinkVisualization";

export function activate(context: vscode.ExtensionContext) {
    const cbrvAPI = new API(context);

    context.subscriptions.push(
        vscode.commands.registerCommand('codeBaseRelationshipVisualizer.start', async () => {
            const visualization = await cbrvAPI.create({
                title: "Codebase Visualization",
            });
        }),
        vscode.commands.registerCommand('hyperlinkGraphVisualization.start', async () => {
            const visualization = await visualizeHyperlinkGraph(cbrvAPI);
        }),
    );

    // TODO: Remove this. Launching automatically for convenience during testing. Also remove "*" activationEvent.
    vscode.commands.executeCommand('hyperlinkGraphVisualization.start');
}
