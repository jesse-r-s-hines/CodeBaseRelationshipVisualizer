import { expect } from 'chai';
import { describe, test } from "mocha";
import "./helpers";

describe("Test tests/helpers.ts", () => {
    it('deepCloseTo', () => {
        expect(1).to.be.deepCloseTo(1);
        expect(1.001).to.be.deepCloseTo(1, 0.005);

        const obj = {a: 1.0001, b: "a", c: [-1e-5, 1e-5]};
        const expected = {a: 1, b: "a", c: [0, 0]};

        expect(obj).to.not.be.deepCloseTo(expected);
        expect(obj).to.be.deepCloseTo(expected, 0.005);
        
        expect("a").to.be.deepCloseTo("a");
        expect([]).to.be.deepCloseTo([]);
    });
});