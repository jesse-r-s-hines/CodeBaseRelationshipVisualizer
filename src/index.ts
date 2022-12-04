import * as vscode from 'vscode';
import { API } from "./api";
import * as codebaseVisualization from "./codebaseVisualization";
import * as hyperlinkVisualization from "./hyperlinkVisualization";
import * as stackTraceVisualization from "./stackTraceVisualization";

export async function activate(context: vscode.ExtensionContext) {
    const cbrvAPI = new API(context);

    await codebaseVisualization.activate(context);
    await hyperlinkVisualization.activate(context);
    await stackTraceVisualization.activate(context);

    // TODO: Remove this. Launching automatically for convenience during testing. Also remove "*" activationEvent.
    vscode.commands.executeCommand('stackTraceVisualization.start');
}
