/** Type definitions for the CBRV public api */
import { SameRule, IgnoreRule, BuiltinMergeRule } from "./mergingTypes";

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
