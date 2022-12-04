import * as vscode from 'vscode';
import { API } from "./api";
import * as codebaseVisualization from "./codebaseVisualization";
import * as visualizeHyperlinkGraph from "./hyperlinkVisualization";

export async function activate(context: vscode.ExtensionContext) {
    const cbrvAPI = new API(context);

    await codebaseVisualization.activate(context);
    await visualizeHyperlinkGraph.activate(context);

    // TODO: Remove this. Launching automatically for convenience during testing. Also remove "*" activationEvent.
    vscode.commands.executeCommand('hyperlinkGraphVisualization.start');
}
