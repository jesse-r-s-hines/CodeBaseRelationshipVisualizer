import _ from "lodash";
import {normalizedJSONStringify} from "../util"

export type MergeRule<Name extends string = string> = {rule: Name} | string
export type SameRule = MergeRule<'same'>;
export type IgnoreRule = MergeRule<'ignore'>;
export type LeastRule = MergeRule<'least'>;
export type GreatestRule = MergeRule<'greatest'>;
export type LeastCommonRule = MergeRule<'leastCommon'>;
export type MostCommonRule = MergeRule<'mostCommon'>;
export type GroupRule = MergeRule<'group'>;
export type AddRule = MergeRule<"add"> | {rule: "add", max: number}
export interface ValueRule {rule: "value", value: any}

const defaultMergers: Record<string, (items: any[], rule: any) => any> = {
    same: items => items[0], // we know all values are the same
    least: items => _(items).min(),
    greatest: items => _(items).max(),
    // find the most/least common item. items is gauranteed to be non-empty
    leastCommon: items => _(items).countBy().toPairs().minBy(([item, count]) => count)![0],
    mostCommon: items => _(items).countBy().toPairs().maxBy(([item, count]) => count)![0],
    add: (items, rule) => rule.max != undefined ? _.min([_(items).sum(), rule.max]) : _(items).sum(),
    value: (items, rule) => items.length == 1 ? items[0] : rule.value,
    group: items => items,
}

export function mergeByRules<T>(
    items: T[],
    rules: Record<string, MergeRule>,
    customMergers: Record<string, (items: any[], rule: any) => any> = {},
): Record<string, any>[] {
    const normalizedRules = _.mapValues(rules, rule => typeof rule == "string" ? {rule: rule} : rule);
    const mergers = {...defaultMergers, ...customMergers}
    const groupKeys = _(normalizedRules).pickBy(rule => rule?.rule == "same").keys().value()

    return _(items)
        // Group items that don't have conflicts on the "same" rules
        .groupBy(item => normalizedJSONStringify(groupKeys.map(key => _.get(item, key))))
        // Compute the merged values for each group
        .map(group => {
            const mergedObj = _(normalizedRules)
                .pickBy(rule => rule?.rule != "ignore") // ignores will be left out of the merged result
                .reduce<Record<string, any>>((accum, rule, prop) => {
                    const items = group.map(item => _.get(item, prop))
                    _.set(accum, prop, mergers[rule.rule](items, rule));
                    return accum;
                }, {})
            return mergedObj
        })
        .value()
}
