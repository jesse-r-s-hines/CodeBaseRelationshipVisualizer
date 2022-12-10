/** Type definitions for the CBRV public api */
import { SameRule, IgnoreRule, BuiltinMergeRule } from "./mergingTypes";

/**
 * Represents a connection or relationship between files. A `Connection` connects two file:line locations in the
 * workspace. `Connections` will be rendered as a line or arrow in the visualization. `line` is optional, in which case
 * the `Connection` will just connect the files and can be passed just the file `Uri`. `Connections` can be between two
 * different files, different lines in the same file, or even connect a file to itself. `Connections` can only connect
 * files, not folders. If `from` or `to` is undefined, the connection will start or end "outside" the visualization.
 * 
 * TODO update docs
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

    width?: BuiltinMergeRule
    color?: BuiltinMergeRule
    tooltip?: BuiltinMergeRule
} | {
    [key: string]: BuiltinMergeRule
}
