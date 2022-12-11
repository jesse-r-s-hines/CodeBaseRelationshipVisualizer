import * as vscode from 'vscode';

import { API } from "./api";
import * as codebaseVisualization from "./visualizations/codebaseVisualization";
import * as hyperlinkVisualization from "./visualizations/hyperlinkVisualization";
import * as stackTraceVisualization from "./visualizations/stackTraceVisualization";
import * as pythonDependencyVisualization from "./visualizations/pythonDependencyVisualization";

export async function activate(context: vscode.ExtensionContext) {
    const cbrvAPI = new API(context);

    await codebaseVisualization.activate(context);
    await hyperlinkVisualization.activate(context);
    await stackTraceVisualization.activate(context);
    await pythonDependencyVisualization.activate(context);

    return cbrvAPI;
}
