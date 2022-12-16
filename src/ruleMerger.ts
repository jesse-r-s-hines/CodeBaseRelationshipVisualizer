import _, { isEqual } from "lodash";

import { normalizedJSONStringify as normJSON } from "./webview/util";

type ParsedMergeRule = {
    prop: string,
    accessor: (o: any) => any,
    virtual: boolean,
    rule: {rule: string, [key: string]: any},
}

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
        first: items => items[0], // we know all values are the same
        last: items => items.at(-1), // we know all values are the same
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

    private rules: ParsedMergeRule[]
    private mergers: Mergers
    private keyFunc: (item: any) => string

    constructor(rules: MergeRules, customMergers?: Mergers, virtualProps: Record<string, any> = {}) {
        this.mergers = {...RuleMerger.defaultMergers, ...customMergers};
        this.rules = RuleMerger.parseRules(rules, this.mergers, virtualProps);

        const groupKeys = _(this.rules)
            .filter(({rule}) => rule?.rule == "same")
            .map(({accessor}) => accessor)
            .value();

         this.keyFunc = (item) => groupKeys
            .map(accessor => {
                const val = accessor(item);
                // hack to make undefined unique JSONized so missing keys group separately
                return val !== undefined ? normJSON(val) : "undefined";
            })
            .join(",");
    }

    merge<T>(items: T[]): Record<string, any>[] {
        return _(items)
            // Group items that don't have conflicts on the "same" rules
            .groupBy(this.keyFunc)
            // Compute the merged values for each group
            .map(group => {
                const mergedObj = _(this.rules)
                    .reduce<Record<string, any>>((accum, {prop, accessor, rule, virtual}) => {
                        const items = group.map(item => accessor(item));
                        const mergedItem = this.mergers[rule.rule](items, rule);
                        if (mergedItem !== undefined && !virtual) {
                            _.set(accum, prop, mergedItem);
                        }
                        return accum;
                    }, {});
                return mergedObj;
            })
            .value();
    }

    /** Normalize and validate rules */
    private static parseRules(rules: MergeRules, mergers: Mergers, virtualProps: Record<string, any>): ParsedMergeRule[] {
        // Check that there's no rules accessing the same paths or parts of the same paths
        const paths = _(rules)
            .omit(Object.keys(virtualProps))
            .map<[string, string[]]>((rule, prop) => [prop, _.toPath(prop)])
            .value();
        for (let i1 = 0; i1 < paths.length; i1++) {
            for (let i2 = i1 + 1; i2 < paths.length; i2++) {
                const [short, long] = _.sortBy([paths[i1], paths[i2]], ([key, path]) => path.length);
                const [[shortKey, shortPath], [longKey, longPath]] = [short, long];
                if (isEqual(shortPath, longPath.slice(0, shortPath.length))) {
                    throw Error(`Duplicate rules for the same key "${shortKey}", "${longKey}"`);
                }
            }
        }

        return _(rules)
            .map((rule, prop) => {
                rule = typeof rule == "string" ? {rule: rule} : rule;
                const virtual = Object.hasOwn(virtualProps, prop);
                // NOTE: I'm not supporting "nested" accessors, i.e. having an accessor on "a" and a rule on "a.b".
                const accessor = _.iteratee(virtual ? virtualProps[prop] : prop);
                
                if (virtual && !["same", "ignore"].includes(rule.rule)) {
                    throw Error(`Virtual rule "${prop}" can only be "same" or "ignore"`);
                } else if (!(rule.rule in mergers)) {
                    throw Error(`Unknown rule "${rule.rule}"`);
                }

                return {prop, accessor, virtual, rule};
            })
            .filter(({rule}) => rule.rule !== "ignore") // filter ignore rules since they don't do anything.
            .value();
    }
}

/** Merge rules that can be used for merging objects with `RuleMerger` */

/** Base interface for any rule for RuleMerger */
export type MergeRule<Name extends string = string> = {rule: Name, [key: string]: any} | string

/** Type for a MergeRule with no arguments that can be represented as just a string, or in the object form. */
export type SimpleMergeRule<Name extends string = string> = {rule: Name} | string

/** An object mapping property names to MergeRule */
export type MergeRules = Record<string, MergeRule>

/** Mergers object contains the implementation of the rules */
export type Mergers = Record<string, (items: any[], rule: any) => any>


/** Only merge objects with equal values for this prop. */
export type SameRule = SimpleMergeRule<'same'>;

/**
 * Ignore this prop when merging objects, i.e. merged objects can have different values for the prop. This prop won't
 * appear on the merged object. This is the default.
 */
export type IgnoreRule = SimpleMergeRule<'ignore'>;

/** Use the first value for this prop. */
export type First = SimpleMergeRule<'first'>;

/** Use the last value for this prop. */
export type Last = SimpleMergeRule<'last'>;

/** Use the smallest value of this prop. */
export type LeastRule = SimpleMergeRule<'least'>;

/** Use the greatest value of this prop. */
export type GreatestRule = SimpleMergeRule<'greatest'>;

/** Use the least common value of this prop. */
export type LeastCommonRule = SimpleMergeRule<'leastCommon'>;

/** Use the most common value of this prop. */
export type MostCommonRule = SimpleMergeRule<'mostCommon'>;

/** Sum the values of this prop up to a max. */
export type AddRule = SimpleMergeRule<"add"> | {rule: "add", max: number}

/** Use this value if there's more than one object to merge, but if there's only one object keep its value. */
export type ValueRule = {rule: "value", value: any}

/** Join the values of this prop as strings with a separator */
export type JoinRule = SimpleMergeRule<"join"> | {rule: "join", sep: string};

/** Combine the values for this prop into an array on the merged connection. */
export type GroupRule = SimpleMergeRule<'group'>;

/** Union type for any merge rule that RuleMerger types understands by default. */
export type BuiltinMergeRule = SameRule | IgnoreRule | First | Last | LeastRule | GreatestRule | LeastCommonRule |
                               MostCommonRule | GroupRule | AddRule | ValueRule | JoinRule
