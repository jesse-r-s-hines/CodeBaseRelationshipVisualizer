import { expect } from 'chai';
import { describe, test } from "mocha";
import { mergeByRules, MergeRules, Mergers } from '../src/webview/merging';

describe("Test merging.ts", () => {
    const basic = [
        {a: 1, b: "a", c: [1], d: true},
        {a: 2, b: "a", c: [2], d: true},
        {a: 4, b: "c", c: [2], d: false},
    ];

    it('basic', () => {
        expect(mergeByRules(basic, {
            a: "add",
            b: "group",
            c: "ignore",
        })).to.eql([
            {a: 7, b: ['a', 'a', 'c']},
        ]);

        expect(mergeByRules(basic, {
            a: "add",
            b: "same",
            c: "group",
        })).to.eql([
            {a: 3, b: 'a', c: [[1], [2]]},
            {a: 4, b: 'c', c: [[2]]},
        ]);

        expect(mergeByRules(basic, {
            a: "add",
            c: "same",
        })).to.eql([
            {a: 1, c: [1]},
            {a: 6, c: [2]},
        ]);

        expect(mergeByRules(basic, {
            a: "same",
            b: "add",
        })).to.eql([
            {a: 1, b: "a"},
            {a: 2, b: "a"},
            {a: 4, b: "c"},
        ]);

        expect(mergeByRules(basic, {
            a: "add",
            b: "same",
            d: "same",
        })).to.eql([
            {a: 3, b: "a", d: true},
            {a: 4, b: "c", d: false},
        ]);

        expect(mergeByRules(basic, {
            a: "same",
            b: "same",
            c: "same",
            d: "same",
        })).to.eql(basic);
    });

    it('Test longform rule format', () => {
        expect(mergeByRules(basic, {
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

        expect(mergeByRules(single, {
            a: "add",
            b: "group",
            c: "ignore",
        })).to.eql([
            {a: 1, b: ['a']},
        ]);

        expect(mergeByRules([], {
            a: "add",
            b: "group",
            c: "ignore",
        })).to.eql([]);

        expect(mergeByRules([{}], {
            a: "same",
        })).to.eql([{}]);

        expect(mergeByRules(basic, {/* Ignore all */})).to.eql([{}]);
    });

    it('nested properties', () => {
        const nested = [
            {a: {id: 1, v: "a"}, b: 1, o: {o1: {o2: 2}}},
            {a: {v: "a", id: 1}, b: 2, o: {o1: {o2: 2}}},
            {a: {id: 2, v: "a"}, b: 3, o: {o1: 3}},
            {a: {id: 1, v: "b"}, b: 4, o: 4},
        ];

        expect(mergeByRules(nested, {
            a: "same",
            b: "group",
        })).to.eql([
            {a: {id: 1, v: "a"}, b: [1, 2]},
            {a: {id: 2, v: "a"}, b: [3]},
            {a: {id: 1, v: "b"}, b: [4]},
        ]);

        expect(mergeByRules(nested, {
            "a.id": "same",
            b: "group",
        })).to.eql([
            {a: {id: 1}, b: [1, 2, 4]},
            {a: {id: 2}, b: [3]},
        ]);

        expect(mergeByRules(nested, {
            "a.id": "same",
            "a.v": "add",
            b: "group",
        })).to.eql([
            {a: {id: 1, v: "aab"}, b: [1, 2, 4]},
            {a: {id: 2, v: "a"}, b: [3]},
        ]);

        expect(mergeByRules(nested, {
            "a.v": "same",
            b: "group",
        })).to.eql([
            {a: {v: "a"}, b: [1, 2, 3]},
            {a: {v: "b"}, b: [4]},
        ]);

        expect(mergeByRules(nested, {
            "a.v": "same",
            b: "group",
        })).to.eql([
            {a: {v: "a"}, b: [1, 2, 3]},
            {a: {v: "b"}, b: [4]},
        ]);
        
        expect(mergeByRules(nested, {
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

        let rules: MergeRules = {a: 'least'};
        expect(mergeByRules([{a: 2}, {a: 1}], rules)).to.eql([{a: 1}]);
        expect(mergeByRules([{a: 1}], rules)).to.eql([{a: 1}]);
        expect(mergeByRules([{a: 1}, {a: 2}, {a: null}, {}], rules)).to.eql([{a: 1}]);
        expect(mergeByRules([{}], rules)).to.eql([{}]);
        expect(mergeByRules([{a: "A"}, {a: "B"}], rules)).to.eql([{a: "A"}]);
        expect(mergeByRules([{a: 1n}, {a: 2n}], rules)).to.eql([{a: 1n}]);

        rules = {a: 'greatest'};
        expect(mergeByRules([{a: 2}, {a: 1}], rules)).to.eql([{a: 2}]);
        expect(mergeByRules([{a: 1}], rules)).to.eql([{a: 1}]);
        expect(mergeByRules([{a: 1}, {a: 2}, {a: null}, {}], rules)).to.eql([{a: 2}]);
        expect(mergeByRules([{}], rules)).to.eql([{}]);
        expect(mergeByRules([{a: "A"}, {a: "B"}], rules)).to.eql([{a: "B"}]);
        expect(mergeByRules([{a: 1n}, {a: 2n}], rules)).to.eql([{a: 2n}]);

        rules = {a: 'leastCommon'};
        expect(mergeByRules([{a: 2}, {a: 2}, {a: 1}], rules)).to.eql([{a: 1}]);
        expect(mergeByRules([{a: 1}], rules)).to.eql([{a: 1}]);
        expect(mergeByRules([{a: 1}, {a: 2}], rules)).to.eql([{a: 1}]); // use first
        expect(mergeByRules([{a: "A"}, {a: "A"}, {a: "B"}], rules)).to.eql([{a: "B"}]);
        expect(mergeByRules([{a: "A"}, {a: "A"}, {a: 1}], rules)).to.eql([{a: 1}]);
        // ignore undefined
        expect(mergeByRules([{a: 1}, {a: 1}, {a: 1}, {a: 2}, {a: 2}, {}], rules)).to.eql([{a: 2}]);
        // null can be returned though
        expect(mergeByRules([{a: 1}, {a: 1}, {a: 1}, {a: 2}, {a: 2}, {a: null}], rules)).to.eql([{a: null}]);
        expect(mergeByRules([{a: {a: 1, b: 2}}, {a: {b: 2, a: 1}}, {a: {a: 2, b: 3}}], rules)).to
            .eql([{a: {a: 2, b: 3}}]);

        rules = {a: 'mostCommon'};
        expect(mergeByRules([{a: 2}, {a: 2}, {a: 1}], rules)).to.eql([{a: 2}]);
        expect(mergeByRules([{a: 1}], rules)).to.eql([{a: 1}]);
        expect(mergeByRules([{a: 1}, {a: 2}], rules)).to.eql([{a: 1}]); // use first
        expect(mergeByRules([{a: "A"}, {a: "A"}, {a: "B"}], rules)).to.eql([{a: "A"}]);
        expect(mergeByRules([{a: "A"}, {a: "A"}, {a: 1}], rules)).to.eql([{a: "A"}]);
        // ignore undefined
        expect(mergeByRules([{}, {}, {}, {a: 2}, {a: 2}, {a: 1}], rules)).to.eql([{a: 2}]);
        // null can be returned though
        expect(mergeByRules([{a: null}, {a: null}, {a: null}, {a: 2}, {a: 2}, {a: 1}], rules)).to.eql([{a: null}]);
        expect(mergeByRules([{a: {a: 1, b: 2}}, {a: {b: 2, a: 1}}, {a: {a: 2, b: 3}}], rules)).to
            .eql([{a: {a: 1, b: 2}}]);


        rules = {a: 'add'};
        expect(mergeByRules([{a: 1}, {a: 2}, {a: 3}], rules)).to.eql([{a: 6}]);
        expect(mergeByRules([{a: "a"}, {a: "b"}], rules)).to.eql([{a: "ab"}]);
        expect(mergeByRules([{a: 1}], rules)).to.eql([{a: 1}]);
        expect(mergeByRules([{a: 1}, {a: 2}, {a: null}, {}], rules)).to.eql([{a: 3}]);
        expect(mergeByRules([{}], rules)).to.eql([{}]);
        expect(mergeByRules([{a: 1n}, {a: 2n}], rules)).to.eql([{a: 3n}]);
        expect(mergeByRules([{a: "a"}, {a: 1}], rules)).to.eql([{a: "a1"}]);

        rules = {a: {rule: 'add', max: 5}};
        expect(mergeByRules([{a: 1}, {a: 2}], rules)).to.eql([{a: 3}]);
        expect(mergeByRules([{a: 1}, {a: 2}, {a: 3}], rules)).to.eql([{a: 5}]);
        expect(mergeByRules([{a: 7}], rules)).to.eql([{a: 5}]);
        expect(mergeByRules([{a: 1}, {a: 2}, {a: null}, {}], rules)).to.eql([{a: 3}]);
        expect(mergeByRules([{}], rules)).to.eql([{}]);

        rules = {a: {rule: 'value', value: "merged"}};
        expect(mergeByRules([{a: 1}, {a: 2}], rules)).to.eql([{a: "merged"}]);
        expect(mergeByRules([{a: 1}, {a: 2}, {a: 3}], rules)).to.eql([{a: "merged"}]);
        expect(mergeByRules([{a: 1}], rules)).to.eql([{a: 1}]);
        expect(mergeByRules([{a: 1}, {a: 2}, {a: null}, {}], rules)).to.eql([{a: "merged"}]);
        expect(mergeByRules([{}], rules)).to.eql([{}]);
        expect(mergeByRules([{}, {}], rules)).to.eql([{}]);
        expect(mergeByRules([{a: 1, b: 2}, {a: 1, b: 3}, {a: 2, b: 4}], {
            a: "same",
            b: {rule: 'value', value: Infinity},
        })).to.eql([
            {a: 1, b: Infinity},
            {a: 2, b: 4},
        ]);

        rules = {a: "group"};
        expect(mergeByRules([{a: 2}, {a: 1}], rules)).to.eql([{a: [2, 1]}]);
        expect(mergeByRules([{a: 1}], rules)).to.eql([{a: [1]}]);
        expect(mergeByRules([{a: 1}, {}, {a: null}], rules)).to.eql([{a: [1, null]}]);
        expect(mergeByRules([{}], rules)).to.eql([{a: []}]);

        rules = {a: 'join'};
        expect(mergeByRules([{a: "A"}, {}, {a: "C"}], rules)).to.eql([{a: "A<br/>C"}]);
        expect(mergeByRules([{a: "A"}], rules)).to.eql([{a: "A"}]);
        expect(mergeByRules([{}], rules)).to.eql([{a: ""}]);

        rules = {a: {rule: 'join', sep: "-"}};
        expect(mergeByRules([{a: "A"}, {a: "B"}, {a: "C"}], rules)).to.eql([{a: "A-B-C"}]);
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

        expect(mergeByRules(data, {
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

        expect(mergeByRules(data, {
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

        expect(mergeByRules(data, {a: 'same', b: 'myMerger'}, mergers)).to.eql([
            {a: 1, b: "a,b"},
            {a: 2, b: "b"},
        ]);

        expect(mergeByRules(data, {a: 'same', b: {rule: 'myMerger', sep: "+"}}, mergers)).to.eql([
            {a: 1, b: "a+b"},
            {a: 2, b: "b"},
        ]);

        mergers = { // override add
            add: items => items.reduce((accum, i) => accum + i.charCodeAt(0), 0)
        };
        expect(mergeByRules(data, {a: 'same', b: 'add'}, mergers)).to.eql([
            {a: 1, b: 97 + 98},
            {a: 2, b: 98},
        ]);
    });

    it('exceptions', () => {
        expect(() => mergeByRules(basic, {a: 'notARule'})).to.throw('Unknown rule "notARule"');

        const nested = [
            {a: 1, o: {o1: 3}},
            {a: 1, o: 4},
        ];

        expect(() => mergeByRules(nested, {o: "group", "o.o1": "add"}))
            .to.throw('Duplicate rules for the same key "o", "o.o1"');

        expect(() => mergeByRules(nested, {a: "add", o: "group", b: "add", "o.o1": "add"}))
            .to.throw('Duplicate rules for the same key "o", "o.o1"');

        expect(mergeByRules(nested, {"o.o2.o3": "group", "o.o2.o4": "group"}))
            .to.eql([{o: {o2: {o3: [], o4: []}} }]);

        expect(() => mergeByRules(nested, {"o.o2.o3": "group", "o.o2": "group"}))
            .to.throw('Duplicate rules for the same key "o.o2.o3", "o.o2"');

        expect(() => mergeByRules(nested, {"o.o2": "group", 'o["o2"]': "group"}))
            .to.throw('Duplicate rules for the same key "o.o2", "o["o2"]"');

        expect(() => mergeByRules(nested, {"o.o2.o3": "group", 'o["o2"]': "group"}))
            .to.throw('Duplicate rules for the same key "o.o2.o3", "o["o2"]"');

        expect(() => mergeByRules(nested, {"o[0]": "group", "o[0][1]": "group"}))
            .to.throw('Duplicate rules for the same key "o[0]", "o[0][1]"');
    });
});

