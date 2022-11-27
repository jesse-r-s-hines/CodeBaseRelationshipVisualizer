import _, { isEqual } from "lodash";
import { normalizedJSONStringify as normJSON } from "../util";
import { MergeRules, Mergers } from "../mergingTypes";

export type NormalizedMergeRule<Name extends string = string> = {rule: Name, [key: string]: any}
export type NormalizedMergeRules = Record<string, NormalizedMergeRule>

const defined = (i: any) => i !== undefined;

/**
 * Merge a list of objects by custom rules. You can specify rules for each property, and specify which objects can merge
 * and which can't. Note that the objects need should be JSONizable.
 * 
 * TODO docs
 */
export class RuleMerger {
    static defaultMergers: Record<string, (items: any[], rule: any) => any> = {
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

    rules: NormalizedMergeRules
    mergers: Mergers

    constructor(rules: MergeRules, customMergers?: Mergers) {
        this.mergers = {...RuleMerger.defaultMergers, ...customMergers};
        this.rules = RuleMerger.normalizeRules(rules, this.mergers);
    }

    merge<T>(items: T[]): Record<string, any>[] {
        const groupKeys = _(this.rules).pickBy(rule => rule?.rule == "same").keys().value();
        const keyFunc = (item: T) => groupKeys
            // hack to make undefined unique JSONized so missing keys group separately
            .map(key => _.get(item, key) !== undefined ? normJSON(_.get(item, key)) : "undefined")
            .join(",");

        return _(items)
            // Group items that don't have conflicts on the "same" rules
            .groupBy(keyFunc)
            // Compute the merged values for each group
            .map(group => {
                const mergedObj = _(this.rules)
                    .reduce<Record<string, any>>((accum, rule, prop) => {
                        const items = group.map(item => _.get(item, prop));
                        const mergedItem = this.mergers[rule.rule](items, rule);
                        if (mergedItem !== undefined) {
                            _.set(accum, prop, mergedItem);
                        }
                        return accum;
                    }, {});
                return mergedObj;
            })
            .value();
    }

    /** Normalize and validate rules */
    private static normalizeRules(rules: MergeRules, mergers: Mergers): NormalizedMergeRules {
        const normalizedRules = _.mapValues(rules, rule => {
            rule = typeof rule == "string" ? {rule: rule} : rule;
            if (!(rule.rule in mergers))
                throw Error(`Unknown rule "${rule.rule}"`);
            return rule;
        });

        // Check that there's no rules accessing the same paths or parts of the same paths
        const paths = Object.keys(normalizedRules).map<[string, string[]]>(p => [p, _.toPath(p)]);
        for (let i1 = 0; i1 < paths.length; i1++) {
            for (let i2 = i1 + 1; i2 < paths.length; i2++) {
                const [short, long] = _.sortBy([paths[i1], paths[i2]], ([key, path]) => path.length);
                const [[shortKey, shortPath], [longKey, longPath]] = [short, long];
                if (isEqual(shortPath, longPath.slice(0, shortPath.length))) {
                    throw Error(`Duplicate rules for the same key "${shortKey}", "${longKey}"`);
                }
            }
        }

        return normalizedRules;
    }
}

