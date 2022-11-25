
import * as vscode from 'vscode';
import { Uri, ViewColumn } from 'vscode';
import { Visualization } from './Visualization';
import { VisualizationSettings, Connection } from './shared';

/**
 * The CodeBase Relationship Visualization API
 */

/**
 * This is the API that the CBRV VSCode extension will expose.
 * 
 * It can be accessed like so:
 *  ```ts
 * let cbrvAPI = extensions.getExtension('CBRV').exports;
 * let visualization = cbrvAPI.create({
 *   // ...
 * })
 * ```
 */
export class API {
    context: vscode.ExtensionContext
    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * Creates a codebase visualization, and opens a window displaying it.
     * @param settings Settings for the visualization
     * @param connections List of connections between files that will be.
     *                    rendered. Defaults to `[]`.
     * @returns The `Visualization` object which can be used to update the visualization.
     */
    create(
        settings: VisualizationSettings,
        connections?: Iterable<Connection>
    ): Visualization {
        const codebase = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!codebase) {
            throw new Error("No workspace to visualize");
        }
        return new Visualization(this.context, settings, codebase, connections);
    }
}
