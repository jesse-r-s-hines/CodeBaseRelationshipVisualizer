import { expect } from 'chai';
import { describe, test } from "mocha";
import { RuleMerger } from '../src/webview/ruleMerger';
import { MergeRules, Mergers } from '../src/mergingTypes';

describe("Test merging.ts", () => {
    const basic = [
        {a: 1, b: "a", c: [1], d: true},
        {a: 2, b: "a", c: [2], d: true},
        {a: 4, b: "c", c: [2], d: false},
    ];

    const merge = (items: any[], rules: MergeRules, customMergers?: Mergers) => {
        const merger = new RuleMerger(rules, customMergers);
        return merger.merge(items);
    }

    it('basic', () => {
        expect(merge(basic, {
            a: "add",
            b: "group",
            c: "ignore",
        })).to.eql([
            {a: 7, b: ['a', 'a', 'c']},
        ]);

        expect(merge(basic, {
            a: "add",
            b: "same",
            c: "group",
        })).to.eql([
            {a: 3, b: 'a', c: [[1], [2]]},
            {a: 4, b: 'c', c: [[2]]},
        ]);

        expect(merge(basic, {
            a: "add",
            c: "same",
        })).to.eql([
            {a: 1, c: [1]},
            {a: 6, c: [2]},
        ]);

        expect(merge(basic, {
            a: "same",
            b: "add",
        })).to.eql([
            {a: 1, b: "a"},
            {a: 2, b: "a"},
            {a: 4, b: "c"},
        ]);

        expect(merge(basic, {
            a: "add",
            b: "same",
            d: "same",
        })).to.eql([
            {a: 3, b: "a", d: true},
            {a: 4, b: "c", d: false},
        ]);

        expect(merge(basic, {
            a: "same",
            b: "same",
            c: "same",
            d: "same",
        })).to.eql(basic);
    });

    it('Test longform rule format', () => {
        expect(merge(basic, {
            a: {rule: "add"},
            b: {rule: "group"},
            c: {rule: "ignore"},
        })).to.eql([
            {a: 7, b: ['a', 'a', 'c']},
        ]);
    });

    it('empty/single lists and objects', () => {
        const single = [
            {a: 1, b: "a", c: [1], d: true},
        ];

        expect(merge(single, {
            a: "add",
            b: "group",
            c: "ignore",
        })).to.eql([
            {a: 1, b: ['a']},
        ]);

        expect(merge([], {
            a: "add",
            b: "group",
            c: "ignore",
        })).to.eql([]);

        expect(merge([{}], {
            a: "same",
        })).to.eql([{}]);

        expect(merge(basic, {/* Ignore all */})).to.eql([{}]);
    });

    it('nested properties', () => {
        const nested = [
            {a: {id: 1, v: "a"}, b: 1, o: {o1: {o2: 2}}},
            {a: {v: "a", id: 1}, b: 2, o: {o1: {o2: 2}}},
            {a: {id: 2, v: "a"}, b: 3, o: {o1: 3}},
            {a: {id: 1, v: "b"}, b: 4, o: 4},
        ];

        expect(merge(nested, {
            a: "same",
            b: "group",
        })).to.eql([
            {a: {id: 1, v: "a"}, b: [1, 2]},
            {a: {id: 2, v: "a"}, b: [3]},
            {a: {id: 1, v: "b"}, b: [4]},
        ]);

        expect(merge(nested, {
            "a.id": "same",
            b: "group",
        })).to.eql([
            {a: {id: 1}, b: [1, 2, 4]},
            {a: {id: 2}, b: [3]},
        ]);

        expect(merge(nested, {
            "a.id": "same",
            "a.v": "add",
            b: "group",
        })).to.eql([
            {a: {id: 1, v: "aab"}, b: [1, 2, 4]},
            {a: {id: 2, v: "a"}, b: [3]},
        ]);

        expect(merge(nested, {
            "a.v": "same",
            b: "group",
        })).to.eql([
            {a: {v: "a"}, b: [1, 2, 3]},
            {a: {v: "b"}, b: [4]},
        ]);

        expect(merge(nested, {
            "a.v": "same",
            b: "group",
        })).to.eql([
            {a: {v: "a"}, b: [1, 2, 3]},
            {a: {v: "b"}, b: [4]},
        ]);
        
        expect(merge(nested, {
            "o.o1.o2": "same",
            b: "group",
        })).to.eql([
            {b: [1, 2], o: {o1: {o2: 2}}},
            {b: [3,4]},
        ]);
    });

    it('test each default merger', () => {
        const data = [
            {num: 1, str: "a", bool: true, int: 1n, sym: Symbol('foo'), obj: {a: 1}, arr: [1,2], n: null, u: undefined},
            {num: 1, str: "a", bool: true, int: 1n, sym: Symbol('foo'), obj: {a: 1}, arr: [1,2], n: null, u: undefined},

            {num: 2, str: "a", bool: true, int: 1n, sym: Symbol('foo'), obj: {a: 1}, arr: [1,2]},
        ];

        let merger: RuleMerger = new RuleMerger({a: 'least'});
        expect(merger.merge([{a: 2}, {a: 1}])).to.eql([{a: 1}]);
        expect(merger.merge([{a: 1}])).to.eql([{a: 1}]);
        expect(merger.merge([{a: 1}, {a: 2}, {a: null}, {}])).to.eql([{a: 1}]);
        expect(merger.merge([{}])).to.eql([{}]);
        expect(merger.merge([{a: "A"}, {a: "B"}])).to.eql([{a: "A"}]);
        expect(merger.merge([{a: 1n}, {a: 2n}])).to.eql([{a: 1n}]);

        merger = new RuleMerger({a: 'greatest'});
        expect(merger.merge([{a: 2}, {a: 1}])).to.eql([{a: 2}]);
        expect(merger.merge([{a: 1}])).to.eql([{a: 1}]);
        expect(merger.merge([{a: 1}, {a: 2}, {a: null}, {}])).to.eql([{a: 2}]);
        expect(merger.merge([{}])).to.eql([{}]);
        expect(merger.merge([{a: "A"}, {a: "B"}])).to.eql([{a: "B"}]);
        expect(merger.merge([{a: 1n}, {a: 2n}])).to.eql([{a: 2n}]);

        merger = new RuleMerger({a: 'leastCommon'});
        expect(merger.merge([{a: 2}, {a: 2}, {a: 1}])).to.eql([{a: 1}]);
        expect(merger.merge([{a: 1}])).to.eql([{a: 1}]);
        expect(merger.merge([{a: 1}, {a: 2}])).to.eql([{a: 1}]); // use first
        expect(merger.merge([{a: "A"}, {a: "A"}, {a: "B"}])).to.eql([{a: "B"}]);
        expect(merger.merge([{a: "A"}, {a: "A"}, {a: 1}])).to.eql([{a: 1}]);
        // ignore undefined
        expect(merger.merge([{a: 1}, {a: 1}, {a: 1}, {a: 2}, {a: 2}, {}])).to.eql([{a: 2}]);
        // null can be returned though
        expect(merger.merge([{a: 1}, {a: 1}, {a: 1}, {a: 2}, {a: 2}, {a: null}])).to.eql([{a: null}]);
        expect(merger.merge([{a: {a: 1, b: 2}}, {a: {b: 2, a: 1}}, {a: {a: 2, b: 3}}])).to
            .eql([{a: {a: 2, b: 3}}]);

        merger = new RuleMerger({a: 'mostCommon'});
        expect(merger.merge([{a: 2}, {a: 2}, {a: 1}])).to.eql([{a: 2}]);
        expect(merger.merge([{a: 1}])).to.eql([{a: 1}]);
        expect(merger.merge([{a: 1}, {a: 2}])).to.eql([{a: 1}]); // use first
        expect(merger.merge([{a: "A"}, {a: "A"}, {a: "B"}])).to.eql([{a: "A"}]);
        expect(merger.merge([{a: "A"}, {a: "A"}, {a: 1}])).to.eql([{a: "A"}]);
        // ignore undefined
        expect(merger.merge([{}, {}, {}, {a: 2}, {a: 2}, {a: 1}])).to.eql([{a: 2}]);
        // null can be returned though
        expect(merger.merge([{a: null}, {a: null}, {a: null}, {a: 2}, {a: 2}, {a: 1}])).to.eql([{a: null}]);
        expect(merger.merge([{a: {a: 1, b: 2}}, {a: {b: 2, a: 1}}, {a: {a: 2, b: 3}}])).to
            .eql([{a: {a: 1, b: 2}}]);


        merger = new RuleMerger({a: 'add'});
        expect(merger.merge([{a: 1}, {a: 2}, {a: 3}])).to.eql([{a: 6}]);
        expect(merger.merge([{a: "a"}, {a: "b"}])).to.eql([{a: "ab"}]);
        expect(merger.merge([{a: 1}])).to.eql([{a: 1}]);
        expect(merger.merge([{a: 1}, {a: 2}, {a: null}, {}])).to.eql([{a: 3}]);
        expect(merger.merge([{}])).to.eql([{}]);
        expect(merger.merge([{a: 1n}, {a: 2n}])).to.eql([{a: 3n}]);
        expect(merger.merge([{a: "a"}, {a: 1}])).to.eql([{a: "a1"}]);

        merger = new RuleMerger({a: {rule: 'add', max: 5}});
        expect(merger.merge([{a: 1}, {a: 2}])).to.eql([{a: 3}]);
        expect(merger.merge([{a: 1}, {a: 2}, {a: 3}])).to.eql([{a: 5}]);
        expect(merger.merge([{a: 7}])).to.eql([{a: 5}]);
        expect(merger.merge([{a: 1}, {a: 2}, {a: null}, {}])).to.eql([{a: 3}]);
        expect(merger.merge([{}])).to.eql([{}]);

        merger = new RuleMerger({a: {rule: 'value', value: "merged"}});
        expect(merger.merge([{a: 1}, {a: 2}])).to.eql([{a: "merged"}]);
        expect(merger.merge([{a: 1}, {a: 2}, {a: 3}])).to.eql([{a: "merged"}]);
        expect(merger.merge([{a: 1}])).to.eql([{a: 1}]);
        expect(merger.merge([{a: 1}, {a: 2}, {a: null}, {}])).to.eql([{a: "merged"}]);
        expect(merger.merge([{}])).to.eql([{}]);
        expect(merger.merge([{}, {}])).to.eql([{}]);

        expect(merge([{a: 1, b: 2}, {a: 1, b: 3}, {a: 2, b: 4}], {
            a: "same",
            b: {rule: 'value', value: Infinity},
        })).to.eql([
            {a: 1, b: Infinity},
            {a: 2, b: 4},
        ]);

        merger = new RuleMerger({a: "group"});
        expect(merger.merge([{a: 2}, {a: 1}])).to.eql([{a: [2, 1]}]);
        expect(merger.merge([{a: 1}])).to.eql([{a: [1]}]);
        expect(merger.merge([{a: 1}, {}, {a: null}])).to.eql([{a: [1, null]}]);
        expect(merger.merge([{}])).to.eql([{a: []}]);

        merger = new RuleMerger({a: 'join'});
        expect(merger.merge([{a: "A"}, {}, {a: "C"}])).to.eql([{a: "A<br/>C"}]);
        expect(merger.merge([{a: "A"}])).to.eql([{a: "A"}]);
        expect(merger.merge([{}])).to.eql([{a: ""}]);

        merger = new RuleMerger({a: {rule: 'join', sep: "-"}});
        expect(merger.merge([{a: "A"}, {a: "B"}, {a: "C"}])).to.eql([{a: "A-B-C"}]);
    });

    it('same on missing', () => {
        const data = [
            {a: 1, b: "a"},
            {a: 1, b: "b"},
            {a: null, b: "c"},
            {a: null, b: "d"},
            {b: "e"},
            {b: "f"},
        ];

        expect(merge(data, {
            a: "same",
            b: "group",
        })).to.eql([
            {a: 1, b: ['a', 'b']},
            {a: null, b: ['c', 'd']},
            {b: ['e', 'f']},
        ]);
    });

    it('same on different types', () => {
        const data = [
            {a: 1, b: "a"},
            {a: 1, b: "b"},
            {a: null, b: "c"},
            {a: null, b: "d"},
            {a: "a", b: "e"},
            {a: "a", b: "f"},
            {a: [], b: "g"},
            {a: [], b: "h"},
            {a: [1], b: "i"},
            {a: {o: 1}, b: "j"},
            {a: {o: 1}, b: "k"},
            {a: {o: 2}, b: "l"},
        ];

        expect(merge(data, {
            a: "same",
            b: "group",
        })).to.eql([
            {a: 1, b: ["a", "b"]},
            {a: null, b: ["c", "d"]},
            {a: "a", b: ["e", "f"]},
            {a: [], b: ["g", "h"]},
            {a: [1], b: ["i"]},
            {a: {o: 1}, b: ["j", "k"]},
            {a: {o: 2}, b: ["l"]},
        ]);
    });

    it('custom mergers', () => {
        const data = [
            {a: 1, b: "a", c: 3},
            {a: 1, b: "b"},
            {a: 2, b: "b"},
        ];

        let mergers: Mergers = {
            myMerger: (items, rule) => items.join(rule.sep ?? ","),
        };

        expect(merge(data, {a: 'same', b: 'myMerger'}, mergers)).to.eql([
            {a: 1, b: "a,b"},
            {a: 2, b: "b"},
        ]);

        expect(merge(data, {a: 'same', b: {rule: 'myMerger', sep: "+"}}, mergers)).to.eql([
            {a: 1, b: "a+b"},
            {a: 2, b: "b"},
        ]);

        mergers = { // override add
            add: items => items.reduce((accum, i) => accum + i.charCodeAt(0), 0)
        };
        expect(merge(data, {a: 'same', b: 'add'}, mergers)).to.eql([
            {a: 1, b: 97 + 98},
            {a: 2, b: 98},
        ]);
    });

    it('exceptions', () => {
        expect(() => new RuleMerger({a: 'notARule'})).to.throw('Unknown rule "notARule"');

        const nested = [
            {a: 1, o: {o1: 3}},
            {a: 1, o: 4},
        ];

        expect(() => new RuleMerger({o: "group", "o.o1": "add"}))
            .to.throw('Duplicate rules for the same key "o", "o.o1"');

        expect(() => new RuleMerger({a: "add", o: "group", b: "add", "o.o1": "add"}))
            .to.throw('Duplicate rules for the same key "o", "o.o1"');

        expect(merge(nested, {"o.o2.o3": "group", "o.o2.o4": "group"}))
            .to.eql([{o: {o2: {o3: [], o4: []}} }]);

        expect(() => new RuleMerger({"o.o2.o3": "group", "o.o2": "group"}))
            .to.throw('Duplicate rules for the same key "o.o2", "o.o2.o3"');

        expect(() => new RuleMerger({"o.o2": "group", 'o["o2"]': "group"}))
            .to.throw('Duplicate rules for the same key "o.o2", "o["o2"]"');

        expect(() => new RuleMerger({"o.o2.o3": "group", 'o["o2"]': "group"}))
            .to.throw('Duplicate rules for the same key "o["o2"]", "o.o2.o3"');

        expect(() => new RuleMerger({"o[0]": "group", "o[0][1]": "group"}))
            .to.throw('Duplicate rules for the same key "o[0]", "o[0][1]"');
    });
});

