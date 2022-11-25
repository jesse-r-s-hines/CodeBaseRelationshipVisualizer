/** Type definitions for the CBRV public api */

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
     * Settings to limit which connections are shown based on the hovered
     * file.
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
        tooltip?: ((conn: MergedConnection) => string|false|undefined)
    }

    /**
     * Rules for how to merge connections when multiple connections go between the same files or folders. If omitted or
     * false connections will never be merged. Setting to true is the same as using all the default merge options.
     * 
     * TODO update these docs
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
     *      - `"least"`: Use the smallest width of the merged connections.
     *      - `"greatest"`: Use the greatest width of the merged connections.
     *      - `"leastCommon"`: Use the least common width among the merged connections.
     *      - `"mostCommon"`: Use the most common width among the merge connections.
     *      - `{rule: "add", max: number}`: Add the widths of the merged connections up to a max. This is the default.
     *      - `{rule: "value", value: number}`: Show merged connections with a different width than single ones.
     * - `color`: How to render the color of merged connections. Can be one of the following values:
     *      - `"same"`: Do not merge connections with different colors.
     *      - `"leastCommon"`: Use the least common color among the merged connections.
     *      - `"mostCommon"`: Use the most common color among the merge connections. This is the default
     *      - `{rule: "value", value: string}`: Show merged connections with a different color than single ones.
     */
    mergeRules?: MergeRules|boolean
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
 * TODO: maybe use Uri instead, or update Docs
 */
export type Endpoint = string | { file: string, line?: number }

export interface NormalizedConnection {
    from?: NormalizedEndpoint
    to?: NormalizedEndpoint
    width?: number
    color?: string
    tooltip?: string
    [key: string]: any
}

export type NormalizedEndpoint = { file: string, line?: number }

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
    from?: NormalizedEndpoint

    /**
    * The file or folder the rendered connection will show to. Can be a
    * folder just like `from`.
    */
    to?: NormalizedEndpoint

    /** True if this merged connection represents connections going both directions between from and to */
    bidirectional: boolean

    width: number
    color: string
    tooltip?: string

    /**
    * The original connections that were merged.
    * Will be sorted using the order function if one is given.
    */
    connections: NormalizedConnection[]

    [key: string]: any
}

export type MergeRules = {
    file?: SameRule | IgnoreRule
    line?: SameRule | IgnoreRule
    direction?: SameRule | IgnoreRule

    width?: SameRule | IgnoreRule | LeastRule | GreatestRule | LeastCommonRule | MostCommonRule | AddRule | ValueRule
    color?: SameRule | IgnoreRule | LeastRule | GreatestRule | LeastCommonRule | MostCommonRule | ValueRule
    tooltip?: SameRule | IgnoreRule | LeastRule | GreatestRule | LeastCommonRule | MostCommonRule | ValueRule | JoinRule
} | {
    [key: string]: BuiltinMergeRule
}

// TODO duplicate types
export type SimpleMergeRule<Name extends string = string> = {rule: Name} | string

export type SameRule = SimpleMergeRule<'same'>;
export type IgnoreRule = SimpleMergeRule<'ignore'>;
export type LeastRule = SimpleMergeRule<'least'>;
export type GreatestRule = SimpleMergeRule<'greatest'>;
export type LeastCommonRule = SimpleMergeRule<'leastCommon'>;
export type MostCommonRule = SimpleMergeRule<'mostCommon'>;
export type GroupRule = SimpleMergeRule<'group'>;
export type AddRule = SimpleMergeRule<"add"> | {rule: "add", max: number}
export type ValueRule = {rule: "value", value: any}
export type JoinRule = SimpleMergeRule<"join"> | {rule: "join", sep: string};
export type BuiltinMergeRule = SameRule | IgnoreRule | LeastRule | GreatestRule | LeastCommonRule | MostCommonRule |
                               GroupRule | AddRule | ValueRule | JoinRule
