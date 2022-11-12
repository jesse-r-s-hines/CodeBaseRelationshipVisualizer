import _ from "lodash";
import { normalizedJSONStringify as normJSON } from "../util"

export type MergeRule<Name extends string = string> = {rule: Name, [key: string]: any} | string
export type SimpleMergeRule<Name extends string = string> = {rule: Name} | string
export type MergeRules = Record<string, MergeRule>

export type SameRule = SimpleMergeRule<'same'>;
export type IgnoreRule = SimpleMergeRule<'ignore'>;
export type LeastRule = SimpleMergeRule<'least'>;
export type GreatestRule = SimpleMergeRule<'greatest'>;
export type LeastCommonRule = SimpleMergeRule<'leastCommon'>;
export type MostCommonRule = SimpleMergeRule<'mostCommon'>;
export type GroupRule = SimpleMergeRule<'group'>;
export type AddRule = SimpleMergeRule<"add"> | {rule: "add", max: number}
export type ValueRule = {rule: "value", value: any}

export type DefaultMergeRule = SameRule | IgnoreRule | LeastRule | GreatestRule | LeastCommonRule | MostCommonRule |
                               GroupRule | AddRule | ValueRule

const defined = (i: any) => i !== undefined

const defaultMergers: Record<string, (items: any[], rule: any) => any> = {
    same: items => items[0], // we know all values are the same
    least: items => _(items).min(),
    greatest: items => _(items).max(),
    // find the most/least common defined item. Ignore undefined items.
    leastCommon: items => _(items).filter(defined).groupBy(normJSON).values().minBy(a => a.length)?.[0],
    mostCommon: items => _(items).filter(defined).groupBy(normJSON).values().maxBy(a => a.length)?.[0],
    add: (items, rule) => {
        const sum = _(items).sum()
        return (rule.max !== undefined && sum !== undefined) ? _.min([sum, rule.max]) : sum
    },
    value: (items, rule) => {
        items = items.filter(defined);
        return items.length <= 1 ? items[0] : rule.value; // may return undefined
    },
    group: items => items.filter(defined),
}

/**
 * Merge a list of objects by custom rules. You can specify rules for each property, and specify which objects can merge
 * and which can't. Note that the objects need should be JSONizable.
 * 
 * TODO docs
 */
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
        .groupBy(item => normJSON(groupKeys.map(key => _.get(item, key))))
        // Compute the merged values for each group
        .map(group => {
            const mergedObj = _(normalizedRules)
                .pickBy(rule => rule?.rule != "ignore") // ignores will be left out of the merged result
                .reduce<Record<string, any>>((accum, rule, prop) => {
                    const items = group.map(item => _.get(item, prop));
                    const mergedItem = mergers[rule.rule](items, rule);
                    if (mergedItem !== undefined) {
                        _.set(accum, prop, mergedItem);
                    }
                    return accum;
                }, {})
            return mergedObj
        })
        .value()
}
