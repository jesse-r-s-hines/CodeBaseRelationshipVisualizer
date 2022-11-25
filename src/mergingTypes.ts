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

export type BuiltinMergeRule = SameRule | IgnoreRule | LeastRule | GreatestRule | LeastCommonRule | MostCommonRule |
                               GroupRule | AddRule | ValueRule | JoinRule
