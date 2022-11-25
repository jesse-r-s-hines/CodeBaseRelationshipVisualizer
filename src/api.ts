import * as vscode from 'vscode';
import { Visualization } from './Visualization';
import { VisualizationSettings, Connection, Endpoint, NormalizedConnection, NormalizedEndpoint, MergedConnection,
         MergeRules } from "./publicTypes";
import { SameRule, IgnoreRule, LeastRule, GreatestRule, LeastCommonRule, MostCommonRule, GroupRule, AddRule, ValueRule,
         JoinRule, BuiltinMergeRule } from "./mergingTypes";

/**
 * The CodeBase Relationship Visualization API
 */

/**
 * This is the API that the CBRV VSCode extension will expose.
 * 
 * It can be accessed like so:
 *  ```ts
 * let cbrvAPI = extensions.getExtension('CBRV').exports;
 * let visualization = await cbrvAPI.create({
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
    async create(
        settings: VisualizationSettings,
        connections?: Iterable<Connection>
    ): Promise<Visualization> {
        const codebase = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!codebase) {
            throw new Error("No workspace to visualize");
        }
        const vis = new Visualization(this.context, codebase, settings, connections);
        await vis.launch();
        return vis;
    }
}

// Re-export public types
export {
    type Visualization,
    VisualizationSettings, Connection, Endpoint, NormalizedConnection, NormalizedEndpoint, MergedConnection, MergeRules,
    SameRule, IgnoreRule, LeastRule, GreatestRule, LeastCommonRule, MostCommonRule, GroupRule, AddRule, ValueRule,
    JoinRule, BuiltinMergeRule,
};