import { expect } from 'chai';
import {mergeByRules} from '../src/webview/merging';

describe("Test merging.ts", () => {
    const basic = [
        {a: 1, b: "a", c: [1], d: true},
        {a: 2, b: "a", c: [2], d: true},
        {a: 4, b: "c", c: [2], d: false},
    ]

    it('basic', () => {
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
            b: "same",
            d: "same",
            a: "add",
        })).to.eql([
            {a: 3, b: "a", d: true},
            {a: 4, b: "c", d: false},
        ])
    })
})

