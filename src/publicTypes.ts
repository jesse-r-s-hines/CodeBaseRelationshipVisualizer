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
