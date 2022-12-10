/** Type definitions for the CBRV public api */
import { SameRule, IgnoreRule, BuiltinMergeRule } from "./mergingTypes";

export interface WebviewConnection { // TODO move to private
    from?: WebviewEndpoint
    to?: WebviewEndpoint
    width?: number
    color?: string
    tooltip?: string
    [key: string]: any
}

export type WebviewEndpoint = { file: string, line?: number }

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
    from?: WebviewEndpoint

    /**
    * The file or folder the rendered connection will show to. Can be a
    * folder just like `from`.
    */
    to?: WebviewEndpoint

    /** True if this merged connection represents connections going both directions between from and to */
    bidirectional: boolean

    width: number
    color: string
    tooltip?: string

    /**
    * The original connections that were merged.
    * Will be sorted using the order function if one is given.
    */
    connections: WebviewConnection[]

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
