import * as vscode from 'vscode';
import { Uri } from 'vscode';
import _ from 'lodash';

import { API, VisualizationSettings } from "../api";

export async function activate(context: vscode.ExtensionContext) {
    const cbrvAPI = new API(context);
    context.subscriptions.push(
        vscode.commands.registerCommand('codeBaseRelationshipVisualizer.start', async () => {
            const visualization = await cbrvAPI.create({
                title: "Codebase Visualization",
            });
        })
    );

}
