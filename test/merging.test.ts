import { expect } from 'chai';
import {mergeByRules} from '../src/webview/merging';

describe("Test merging.ts", () => {
    it('basic', () => {
        const basic = [
            {a: 1, b: "a", c: [1], d: true},
            {a: 2, b: "a", c: [2], d: true},
            {a: 4, b: "c", c: [2], d: false},
        ]

        expect(mergeByRules(basic, {
            a: "add",
            b: "group",
            c: "ignore",
        })).to.eql([
            {a: 7, b: ['a', 'a', 'c']},
        ])

        expect(mergeByRules(basic, {
            a: "add",
            b: "same",
            c: "group",
        })).to.eql([
            {a: 3, b: 'a', c: [[1], [2]]},
            {a: 4, b: 'c', c: [[2]]},
        ])

        expect(mergeByRules(basic, {
            a: "add",
            c: "same",
        })).to.eql([
            {a: 1, c: [1]},
            {a: 6, c: [2]},
        ])

        expect(mergeByRules(basic, {
            a: "same",
            b: "add",
        })).to.eql([
            {a: 1, b: "a"},
            {a: 2, b: "a"},
            {a: 4, b: "c"},
        ])

        expect(mergeByRules(basic, {
            a: "add",
            b: "same",
            d: "same",
        })).to.eql([
            {a: 3, b: "a", d: true},
            {a: 4, b: "c", d: false},
        ])

        expect(mergeByRules(basic, {
            a: "same",
            b: "same",
            c: "same",
            d: "same",
        })).to.eql(basic)
    })

    it('empty/single lists', () => {
        const single = [
            {a: 1, b: "a", c: [1], d: true},
        ]

        expect(mergeByRules(single, {
            a: "add",
            b: "group",
            c: "ignore",
        })).to.eql([
            {a: 1, b: ['a']},
        ])

        expect(mergeByRules([], {
            a: "add",
            b: "group",
            c: "ignore",
        })).to.eql([])
    })

    it('nested properties', () => {
        const nested = [
            {a: {id: 1, v: "a"}, b: 1, o: {o1: {o2: 2}}},
            {a: {v: "a", id: 1}, b: 2, o: {o1: {o2: 2}}},
            {a: {id: 2, v: "a"}, b: 3, o: {o1: 3}},
            {a: {id: 1, v: "b"}, b: 4, o: 4},
        ]

        expect(mergeByRules(nested, {
            a: "same",
            b: "group",
        })).to.eql([
            {a: {id: 1, v: "a"}, b: [1, 2]},
            {a: {id: 2, v: "a"}, b: [3]},
            {a: {id: 1, v: "b"}, b: [4]},
        ])

        expect(mergeByRules(nested, {
            "a.id": "same",
            b: "group",
        })).to.eql([
            {a: {id: 1}, b: [1, 2, 4]},
            {a: {id: 2}, b: [3]},
        ])

        expect(mergeByRules(nested, {
            "a.id": "same",
            "a.v": "add",
            b: "group",
        })).to.eql([
            {a: {id: 1, v: "aab"}, b: [1, 2, 4]},
            {a: {id: 2, v: "a"}, b: [3]},
        ])

        expect(mergeByRules(nested, {
            "a.v": "same",
            b: "group",
        })).to.eql([
            {a: {v: "a"}, b: [1, 2, 3]},
            {a: {v: "b"}, b: [4]},
        ])

        expect(mergeByRules(nested, {
            "a.v": "same",
            b: "group",
        })).to.eql([
            {a: {v: "a"}, b: [1, 2, 3]},
            {a: {v: "b"}, b: [4]},
        ])
        
        expect(mergeByRules(nested, {
            "o.o1.o2": "same",
            b: "group",
        })).to.eql([
            {b: [1, 2], o: {o1: {o2: 2}}},
            {b: [3,4], o: {o1: {o2: undefined}}},
        ])
        
    })
})

