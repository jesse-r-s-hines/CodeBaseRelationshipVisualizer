import * as vscode from 'vscode';
import { Uri, Webview, WebviewPanel, FileSystemWatcher, workspace } from 'vscode';
import * as path from "path";
import { DeepRequired } from "ts-essentials";
import _, { isEqual, cloneDeep } from 'lodash';

import { WebviewVisualizationSettings, WebviewConnection, WebviewEndpoint, CBRVMessage, CBRVWebviewMessage, Directory,
         VisualizationMergeRules } from "./types";
import * as fileHelper from "./fileHelper";

type VisualizationState = InstanceType<typeof Visualization.VisualizationState>;

/**
 * Settings and configuration for a Visualization.
 */
export interface VisualizationSettings {
    /**
     * Title for the internal webview. See https://code.visualstudio.com/api/references/vscode-api#WebviewPanel
     */
    title?: string

    /**
     * Whether each connection is directed (an arrow) or not (a line).
     * Default false.
     */
    directed?: boolean

    /**
     * Settings to limit which connections are shown based on the hovered file by default. These can be overridden by
     * the use via the controls.
     * 
     * Can be set to:
     * - `"in"`: Show only directed connections into the hovered file.
     * - `"out"`: Show only directed connections out of the hovered file.
     * - `"both"`: Show all connections connected to the hovered file.
     * - `true`: Same as "both".
     * - `false`: Default. Ignore hover, show connections for all files.
     * 
     * If connections are undirected, "in", "out", and "both" behave the same.
     */
    showOnHover?: "in"|"out"|"both"|boolean

    connectionDefaults?: {
        /** Default width of the SVG path for connections. Can be overridden per connection via `Connection.width` */
        width?: number

        /** Default CSS color string for connections. Can be overridden per connection via `Connection.color` */
        color?: string

        /**
         * A function to return a HTML tooltip string for each connection. If the function returns falsy, no tooltip
         * will shown. Default is to return. Default is to use `connection.tooltip` or no tooltip if not present and to
         * join unique tooltips with <br> when merging.
         */
        tooltip?: ((conn: MergedConnection, vis: Visualization) => string|false|undefined)
    }

    /**
     * Rules for how to merge connections when multiple connections go between the same files or folders. This can occur
     * if you have duplicate connections in the connection list, or because of dynamic zoom. If you zoom out enough
     * to hide a folder's contents, all the connections to it will render to the folder instead of the contents.
     * 
     * If false, connections will never be merged. By default, all connections between the same two files or folders
     * will be merged. Setting to true is the same as using all the default merge options.
     * 
     * Pass an object where each key is a custom property in your `Connection`s and each value is one of:
     * - `"same"`: Only merge connections with equal values for this prop.
     * - `"ignore"`: Ignore this prop when merging connections, i.e. merged connections can have different values for
     *               the prop. This is the default.
     * 
     * The following special keys are recognized, in addition to custom props on `Connection`.
     * - `file`: One of `"same"` or `"ignore"`. Whether to merge connections that go to different files (this can happen
     *           because of dynamic zoom). Default `"ignore"`.
     * - `line`: One of `"same"` or `"ignore"`. Whether to merge connections that go to different lines within the same
     *           file. Only applicable when `file` is `"same"`. Default `"ignore"`.
     * - `direction`: One of `"same"` or `"ignore"`.Whether to merge opposite direction connections into one
     *                double-headed arrow. Only applicable if connections are directed. Default `"ignore"`.
     * - `width`: How to render the width of merged connections. Can be one of the following values:
     *      - `"same"`: Do not merge connections with different widths.
     *      - `"first"`: Use the width of the first connection.
     *      - `"last"`: Use the width of the last connection.
     *      - `"least"`: Use the smallest width of the merged connections.
     *      - `"greatest"`: Use the greatest width of the merged connections.
     *      - `"leastCommon"`: Use the least common width among the merged connections.
     *      - `"mostCommon"`: Use the most common width among the merge connections.
     *      - `{rule: "add", max: number}`: Add the widths of the merged connections up to a max. This is the default.
     *      - `{rule: "value", value: number}`: Show merged connections with a different width than single ones.
     * - `color`: How to render the color of merged connections. Can be one of the following values:
     *      - `"same"`: Do not merge connections with different colors.
     *      - `"first"`: Use the color of the first connection.
     *      - `"last"`: Use the color of the last connection.
     *      - `"leastCommon"`: Use the least common color among the merged connections.
     *      - `"mostCommon"`: Use the most common color among the merge connections. This is the default
     *      - `{rule: "value", value: string}`: Show merged connections with a different color than single ones.
     */
    mergeRules?: VisualizationMergeRules|boolean

    /**
     * The default filters on what files will show in the visualization.
     * The user can still modify these defaults in the visualization.
     */
    filters?: {
        /**
         * Exclude files that match these comma separated glob patterns.
         * Can be overridden by the user via the controls.
         */
        exclude?: string
  
        /**
         * Include only files that match these comma separated glob patterns.
         * Can be overridden by the user via the controls.
         */
        include?: string
  
        /**
         * If true, only files with connections to them will be shown. Default false, which will show all files.
         * Can be overridden by the user via the controls.
         */
        hideUnconnected?: boolean,
    }

    /**
     * Context menu options that will show for files and folders in addition to the default ones.
     */
    contextMenu?: {
        file?: ContextMenuItem[]
        directory?: ContextMenuItem[]
    }
}

export type ContextMenuItem = {
    title: string,
    action: ((uri: Uri, vis: Visualization) => void),
}

/**
 * Represents a connection or relationship between files. A `Connection` connects two file:line locations in the
 * workspace. `Connections` will be rendered as a line or arrow in the visualization. `line` is optional, in which case
 * the `Connection` will just connect the files and can be passed just the file `Uri`. `Connections` can be between two
 * different files, different lines in the same file, or even connect a file to itself. `Connections` can only connect
 * files, not folders. If `from` or `to` is undefined, the connection will start or end "outside" the visualization.
 * 
 * E.g.
 * ```ts
 * {
 *   from: {file: Uri.file("main.py"), line: 10},
 *   to: {file: Uri.file("tutorial.py"), line: 3}
 * }
 * ```
 * or
 * ```ts
 * {
 *   from: Uri.file("main.py"),
 *   to: Uri.file("tutorial.py")
 * }
 * ```
 */
 export interface Connection {
    from?: Endpoint
    to?: Endpoint

    /** Width of the SVG path */
    width?: number

    /** CSS color string */
    color?: string

    /** String to show as tooltip */
    tooltip?: string

    /**
     * Other properties can be defined on the `Connection` and referenced in the tooltip callback or `MergeRules`.
     */
    [key: string]: any
}

/**
 * Represents one endpoint of a `Connection`. Can be a path to the file or an object containing a path and an optional
 * line number.
 */
export type Endpoint = Uri | { file: Uri, line?: number }

/**
 * Represents a merged group of connections, that will be rendered as one
 * line in the visualization. The connections are grouped together based
 * on the merge rules.
 */
export interface MergedConnection {
    /**
    * The file/folder the rendered connection will show from. This can be a
    * folder when there are deeply nested files which are hidden until the
    * user zooms in. Then connections to those files will show connected to
    * the visible parent folder.
    */
    from?: { file: Uri, line?: number }

    /**
    * The file or folder the rendered connection will show to. Can be a
    * folder just like `from`.
    */
    to?: { file: Uri, line?: number }

    /** True if this merged connection represents connections going both directions between from and to */
    bidirectional: boolean

    width: number
    color: string
    tooltip?: string

    /**
    * The original connections that were merged.
    * Will be sorted using the order function if one is given.
    */
    connections: Connection[]

    [key: string]: any
}

/**
 * Handles the visualization, allowing you to update the visualization.
 */
export class Visualization {
    private context: vscode.ExtensionContext;
    public readonly codebase: Uri
    private originalSettings: VisualizationSettings;
    private settings: DeepRequired<VisualizationSettings>
    private connections: Connection[] = []

    private webviewPanel?: WebviewPanel
    private fsWatcher?: FileSystemWatcher

    private files: Uri[] = [];

    private onFSChangeCallback?: (visState: VisualizationState) => Promise<void>

    private static readonly defaultSettings: DeepRequired<VisualizationSettings> = {
        title: 'CodeBase Relationship Visualizer',
        directed: false,
        showOnHover: false,
        connectionDefaults: {
            width: 2,
            color: 'yellow',
            tooltip: (conn) => conn.tooltip,
        },
        mergeRules: {
            file: "ignore",
            line: "ignore",
            direction: "ignore",
            width: { rule: "add", max: 4 },
            color: "mostCommon",
            tooltip: { rule: "join", sep: "<br/>" },
        },
        filters: {
            include: "",
            exclude: "",
            hideUnconnected: false,
        },
        contextMenu: {
            file: [
                {
                    title: 'Reveal in Explorer',
                    action: async (uri) => await vscode.commands.executeCommand("revealInExplorer", uri),
                }, {
                    title: 'Open in Editor',
                    action: async (uri) => await vscode.commands.executeCommand("vscode.open", uri),
                }, {
                    title: 'Copy Path',
                    action: (uri) => vscode.env.clipboard.writeText(uri.fsPath),
                }, {
                    title: 'Copy Relative Path',
                    action: (uri, vis) =>
                        vscode.env.clipboard.writeText(path.relative(vis.codebase.fsPath, uri.fsPath)),
                }
            ],
            directory: [
                {
                    title: 'Reveal in Explorer',
                    action: async (uri) => await vscode.commands.executeCommand("revealInExplorer", uri),
                }, {
                    title: 'Copy Path',
                    action: (uri) => vscode.env.clipboard.writeText(uri.fsPath),
                }, {
                    title: 'Copy Relative Path',
                    action: (uri, vis) =>
                        vscode.env.clipboard.writeText(path.relative(vis.codebase.fsPath, uri.fsPath)),
                }
            ]
        }
    };

    constructor(
        context: vscode.ExtensionContext,
        codebase: Uri,
        settings: VisualizationSettings = {},
    ) {
        this.context = context;
        this.originalSettings = settings;
        this.settings = this.normalizeSettings(settings);
        this.codebase = codebase;
    }

    /** A mutable "view" on a Visualization */
    static VisualizationState = class {
        private visualization: Visualization

        settings: VisualizationSettings
        connections: Connection[]
        
        constructor(visualization: Visualization) {
            this.visualization = visualization;
            this.settings = cloneDeep(this.visualization.originalSettings);
            this.connections = cloneDeep(this.visualization.connections);
        }

        /** The root of the codebase we are visualizing */
        get codebase(): Uri { return this.visualization.codebase; }

        /** Get a list of all the files included by the current include/exclude settings. */
        get files(): Uri[] { return this.visualization.files; }

        // /** TODO
        // * Return connections that are connected to the given file. Optionally
        // * specify the direction the are going relative to the file.
        // */
        // getConnected(file: Uri, direction?: Direction): Connection[]
    }

    /**
     * Used to update the visualization. Update the state in the callback and the visualization will update after
     * calling the callback.
     */
    async update(func: (visState: VisualizationState) => Promise<void>): Promise<void> {
        const state = new Visualization.VisualizationState(this);
        await func(state); // user can mutate settings and connections in here
        
        const send = {settings: false, connections: false};

        if (!isEqual(this.originalSettings, state.settings)) {
            this.originalSettings = state.settings;
            this.settings = this.normalizeSettings(state.settings);
            if (this.webviewPanel) {
                this.webviewPanel.title == this.settings.title;
            }
            send.settings = true;
        }

        if (!isEqual(this.connections, state.connections)) {
            this.connections = state.connections;
            send.connections = true;
        }

        await this.sendSet(send);
    }

    /**
     * Set the callback to update the visualization whenever the files change. Shortcut for setting up a custom
     * FileSystemWatcher on the codebase that calls `Visualization.update`.
     * 
     * You can pass `{immediate: true}` if you want it to trigger immediately as well.
     */
    onFSChange(func: (visState: VisualizationState) => Promise<void>, options?: {immediate?: boolean}): void {
        this.onFSChangeCallback = func;
        if (options?.immediate ?? false) {
            this.update(this.onFSChangeCallback);
        }
    }


    /**
     * These properties and methods are just passed through to the internal webview panel.
     * See https://code.visualstudio.com/api/references/vscode-api#WebviewPanel
     */
    get active() { return this.webviewPanel!.active; }
    get viewColumn() { return this.webviewPanel!.viewColumn; }
    get visible() { return this.webviewPanel!.visible; }
    reveal(viewColumn?: vscode.ViewColumn, preserveFocus?: boolean): void {
        this.webviewPanel!.reveal(viewColumn, preserveFocus);
    }

    async launch() {
        if (this.webviewPanel) {
            throw new Error("Visualization launched twice");
        }
        this.webviewPanel = this.createWebviewPanel();

        // Await until we get the ready message from the webview
        await new Promise((resolve, reject) => {
            const disposable = this.webviewPanel!.webview.onDidReceiveMessage(
                async (message: CBRVWebviewMessage) => {
                    if (message.type == "ready") {
                        disposable.dispose();
                        resolve(undefined);
                    } else {
                        reject(new Error('First message should be "ready"'));
                    }
                }
            );
        });

        await this.updateFileList();
        await this.sendSet({codebase: true, settings: true, connections: true});
        this.setupWatcher();

        this.webviewPanel.webview.onDidReceiveMessage(
            async (message: CBRVWebviewMessage) => {
                if (message.type == "ready") { // we can get ready again if the webview closes and reopens.
                    await this.sendSet({codebase: true, settings: true, connections: true});
                } else if (message.type == "open") {
                    // NOTE: we could do these and Command URIs inside the webview instead. That might be simpler
                    await vscode.commands.executeCommand("vscode.open", this.getUri(message.file));
                } else if (message.type == "reveal-in-explorer") {
                    await vscode.commands.executeCommand("revealInExplorer", this.getUri(message.file));
                } else if (message.type == "tooltip-request") {
                    const convEndpoint = (e: WebviewEndpoint|undefined) =>
                        e ? {
                            file: Uri.file(path.resolve(this.codebase.fsPath, e.file)),
                            line: e.line,
                        } : undefined;

                    const conn: MergedConnection = {
                        ...message.conn,
                        from: convEndpoint(message.conn.from),
                        to: convEndpoint(message.conn.to),
                        connections: message.conn.connections.map(i => this.connections[i]),
                    };

                    await this.send({
                        type: "tooltip-set",
                        id: message.id,
                        content: this.settings.connectionDefaults.tooltip(conn, this) || "",
                    });
                } else if (message.type == "update-settings") {
                    this.settings = _.merge({}, this.settings, message.settings);
                    const filters = message.settings.filters;
                    if (filters?.include != undefined || filters?.exclude != undefined) {
                        await this.updateFileList();
                        await this.sendSet({codebase: true});
                    }
                } else if (message.type == "context-menu-action") {
                    const [menu, i] = message.action.split("-");
                    const uri = this.getUri(message.file);
                    this.settings.contextMenu[menu as 'file'|'directory'][Number(i)].action(uri, this);
                }
            },
            undefined,
            this.context.subscriptions
        );
    }

    /** Destroy the visualization and all webviews/watchers etc. */
    dispose(): void {
        this.webviewPanel?.dispose();
        this.fsWatcher?.dispose();
    }

    /** Takes an endpoint of a connection and returns the path relative to the codebase */
    getRelativePath(end: Endpoint|undefined): string|undefined {
        const uri = (end instanceof Uri) ? end : end?.file;
        return uri ? path.relative(this.codebase.fsPath, uri.fsPath) : undefined;
    }

    /** Takes a endpoint of a connection and returns the line number, if there is one. */
    getLine(end: Endpoint|undefined): number|undefined {
        return (end instanceof Uri) ? undefined : end?.line;
    }

    /**
     * Updates stuff after the codebase or include/exclude settings have changed.
     */
    private async updateFileList(): Promise<void> {
        const {include, exclude} = this.settings.filters;
        this.files = await fileHelper.getFilteredFileList(this.codebase, include || '**/*', exclude);
    }

    /** Returns a complete settings object with defaults filled in an normalized a bit.  */
    private normalizeSettings(settings: VisualizationSettings): DeepRequired<VisualizationSettings> {
        settings = cloneDeep(settings);
        if (settings.mergeRules === true) {
            settings.mergeRules = {}; // just use all the defaults
        }
        if (settings.showOnHover === true) {
            settings.showOnHover = "both";
        }
        // prepend defaults to menu items (if they are specified)
        if (settings.contextMenu?.file)
            settings.contextMenu.file.splice(0, 0, ...Visualization.defaultSettings.contextMenu.file);
        if (settings.contextMenu?.directory)
            settings.contextMenu.directory.splice(0, 0, ...Visualization.defaultSettings.contextMenu.directory);

        settings = _.merge({}, Visualization.defaultSettings, settings);

        return settings as DeepRequired<VisualizationSettings>;
    }

        /** Returns a complete settings object with defaults filled in an normalized a bit.  */
    private getWebviewSettings(): WebviewVisualizationSettings {
        const webviewSettings = {
            ..._.omit(this.settings, ["title", "connectionDefaults.tooltip", "contextMenu"]),
            contextMenu: {
                file: this.settings.contextMenu.file.map((item, i) => ({...item, action: `file-${i}`})),
                directory: this.settings.contextMenu.directory.map((item, i) => ({...item, action: `directory-${i}`})),
            }
        };
        return webviewSettings as WebviewVisualizationSettings;
    }

    private setupWatcher() {
        // TODO VSCode watcher may be ignoring some file trees like node_modules by default.
        this.fsWatcher = workspace.createFileSystemWatcher(
            // Watch entire codebase. The workspace is watched by default, so it shouldn't be a performance
            // issue to add a broad watcher for it since it will just use the default watcher. We'll check
            // include/exclude the callback.
            new vscode.RelativePattern(this.codebase, '**/*')
        );

        const callback = async () => {
            await this.sendSet({codebase: true});
            if (this.onFSChangeCallback) {
                this.update(this.onFSChangeCallback);
            }
        };

        const inFiles = (uri: Uri) => this.files.some(u => u.fsPath == uri.fsPath);

        this.fsWatcher.onDidChange(async uri => {
            if (inFiles(uri)) {
                await callback();
                // don't need to update file list
            }
        });
        this.fsWatcher.onDidCreate(async uri => {
            await this.updateFileList();
            if (inFiles(uri)) {
                callback(); // check if in new file list
            }
        });
        this.fsWatcher.onDidDelete(async uri => {
            if (inFiles(uri)) { // check if in original file list
                await this.updateFileList();
                callback();
            }
        });
    }

    private createWebviewPanel(): WebviewPanel {
        // Create and show panel
        const panel = vscode.window.createWebviewPanel(
            'codeBaseRelationshipVisualizer',
            this.settings.title,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.file(this.context.extensionPath)],
                // enableCommandUris: true,
            }
        );

        panel.webview.html = this.getWebviewContent(panel.webview);

        return panel;
    }

    private getWebviewContent(webview: Webview): string {
        const extPath = vscode.Uri.file(this.context.extensionPath);
        const scriptUri = webview.asWebviewUri(Uri.joinPath(extPath, "dist", "webview", "webview.js"));
        const stylesUri = webview.asWebviewUri(Uri.joinPath(extPath, "src", "webview", "CBRVStyles.css"));

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>CodeBase Relationship Visualizer</title>
                <link rel="stylesheet" href="${stylesUri}">
            </head>
            <body>
                <div id="filters">
                    <div class="form-input">
                        <label for="include">Files to include</label>
                        <input id="include" title="e.g. *.ts, src/**/include"></input>
                    </div>
                    <div class="form-input">
                        <label for="exclude">File to exclude</label>
                        <input id="exclude" title="e.g. *.ts, src/**/include"></input>
                    </div>
                    <div class="form-input">
                        <label for="hide-unconnected">Hide Unconnected</label>
                        <input id="hide-unconnected" type="checkbox"></input>
                    </div>
                    <div class="form-input">
                        <label for="show-on-hover">Show on hover:</label>
                        <select name="show-on-hover" id="show-on-hover">
                            <option value="off" selected>Off</option>
                            <option value="both">All</option>
                            <option value="in">In only</option>
                            <option value="out">Out only</option>
                        </select> 
                    </div>
                </div>
                <svg id="diagram"></svg>
                <script>var exports = {}</script>
                <script src="${scriptUri}"></script>
            </body>
            </html>
        `;
    }

    private async sendSet(send: {codebase?: boolean, settings?: boolean, connections?: boolean}) {
        let codebase: Directory|undefined;
        if (send.codebase) {
            codebase = await fileHelper.listToFileTree(this.codebase, this.files);
        }

        let settings: WebviewVisualizationSettings|undefined;
        if (send.settings) {
            settings = this.getWebviewSettings();
        }

        let connections: WebviewConnection[]|undefined;
        if (send.connections) {
            connections = this.connections?.map(conn => {
                if (!conn.from && !conn.to) {
                    throw Error("Connections must have at least one of from or to defined");
                }
                const convEndpoint = (e: Endpoint|undefined) => {
                    if (e) {
                        return e ? {
                            file: this.getRelativePath(e)!.replace("\\", '/'), // normalize to unix style
                            line: this.getLine(e),
                        } : undefined;
                    } else {
                        return undefined;
                    }
                };

                return {...conn, from: convEndpoint(conn.from), to: convEndpoint(conn.to)};
            });
        }

        await this.send({ type: "set", settings, codebase, connections });
    }
    
    private async send(message: CBRVMessage) {
        await this.webviewPanel!.webview.postMessage(message);
    }

    private getUri(file: string): Uri {
        return vscode.Uri.file(`${this.codebase.fsPath}/${file}`);
    }
}



