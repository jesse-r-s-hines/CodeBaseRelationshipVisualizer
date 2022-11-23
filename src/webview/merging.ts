import _, { isEqual } from "lodash";
import { normalizedJSONStringify as normJSON } from "../util";

export type MergeRule<Name extends string = string> = {rule: Name, [key: string]: any} | string
export type SimpleMergeRule<Name extends string = string> = {rule: Name} | string
export type MergeRules = Record<string, MergeRule>
export type Mergers = Record<string, (items: any[], rule: any) => any>

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

export type DefaultMergeRule = SameRule | IgnoreRule | LeastRule | GreatestRule | LeastCommonRule | MostCommonRule |
                               GroupRule | AddRule | ValueRule | JoinRule

const defined = (i: any) => i !== undefined;

const defaultMergers: Record<string, (items: any[], rule: any) => any> = {
    same: items => items[0], // we know all values are the same
    ignore: items => undefined, // will be omitted
    least: items => _(items).min(),
    greatest: items => _(items).max(),
    // find the most/least common defined item. Ignore undefined items.
    leastCommon: items => _(items).filter(defined).groupBy(normJSON).values().minBy(a => a.length)?.[0],
    mostCommon: items => _(items).filter(defined).groupBy(normJSON).values().maxBy(a => a.length)?.[0],
    add: (items, rule) => {
        const sum = _(items).sum();
        return (rule.max !== undefined && sum !== undefined) ? _.min([sum, rule.max]) : sum;
    },
    value: (items, rule) => {
        items = items.filter(defined);
        return items.length <= 1 ? items[0] : rule.value; // may return undefined
    },
    group: items => items.filter(defined),
    join: (items, rule) => items.filter(defined).join(rule.sep ?? "<br/>")
};

/** Normalize and validate rules */
function normalizeRules(rules: MergeRules, mergers: Mergers) {
    const normalizedRules = _.mapValues(rules, rule => typeof rule == "string" ? {rule: rule} : rule);

    // check rules are all known
    for (let rule of Object.values(normalizedRules))
        if (!(rule.rule in mergers)) throw Error(`Unknown rule "${rule.rule}"`);

    // Check that there's no rules accessing the same paths or parts of the same paths
    const paths = Object.keys(normalizedRules);
    for (let i1 = 0; i1 < paths.length; i1++) {
        for (let i2 = i1 + 1; i2 < paths.length; i2++) {
            let [short, long] = _.sortBy([paths[i1], paths[i2]].map(_.toPath), p => p.length);
            if (isEqual(short, long.slice(0, short.length))) {
                throw Error(`Duplicate rules for the same key "${paths[i1]}", "${paths[i2]}"`);
            }
        }
    }

    return normalizedRules;
}

/**
 * Merge a list of objects by custom rules. You can specify rules for each property, and specify which objects can merge
 * and which can't. Note that the objects need should be JSONizable.
 * 
 * TODO docs
 */
export function mergeByRules<T>(
    items: T[],
    rules: MergeRules,
    customMergers: Mergers = {},
): Record<string, any>[] {
    const mergers = {...defaultMergers, ...customMergers};
    const normalizedRules = normalizeRules(rules, mergers);

    const groupKeys = _(normalizedRules).pickBy(rule => rule?.rule == "same").keys().value();
    const keyFunc = (item: T) => groupKeys
        // hack to make undefined unique JSONized so missing keys group separately
        .map(key => _.get(item, key) !== undefined ? normJSON(_.get(item, key)) : "undefined")
        .join(",");

    return _(items)
        // Group items that don't have conflicts on the "same" rules
        .groupBy(keyFunc)
        // Compute the merged values for each group
        .map(group => {
            const mergedObj = _(normalizedRules)
                .reduce<Record<string, any>>((accum, rule, prop) => {
                    const items = group.map(item => _.get(item, prop));
                    const mergedItem = mergers[rule.rule](items, rule);
                    if (mergedItem !== undefined) {
                        _.set(accum, prop, mergedItem);
                    }
                    return accum;
                }, {});
            return mergedObj;
        })
        .value();
}
