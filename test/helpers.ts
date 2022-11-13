import { Assertion } from 'chai';
import _ from "lodash"

declare global {
    export namespace Chai {
        interface Assertion {
            deepCloseTo(expected: any, epsilon?: number): Promise<void>;
        }
    }
}

Assertion.addMethod('deepCloseTo', function(expected: any, epsilon = 1e-8) {
    this.assert(
        _.isEqualWith(this._obj, expected,
            // compare numbers with epsilon, everything else return undefined to use default
            (a, b) => [a, b].every(x => typeof x == "number") ? Math.abs(a - b) < epsilon : undefined // undefined to use default
        ),
        "expected #{this} to be approximately equal to #{exp} but got #{act}",
        "expected #{this} to not be approximately equal to #{exp} but got #{act}",
        expected, // expected
        this._obj, // actual,
        true,
    );
});

