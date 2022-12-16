import { expect } from 'chai';
import { describe, test } from "mocha";

import "./helpers"; // add custom assertions
import * as geo from '../src/util/geometry';
import { Point, Box } from '../src/util/geometry';


describe("Test geometry.ts", () => {
    it('distance', () => {
        expect(geo.distance([1, 2], [3, 4])).to.be.closeTo(2.828, 0.0005);
        expect(geo.distance([3, 4], [1, 2])).to.be.closeTo(2.828, 0.0005);
        expect(geo.distance([0, 0], [1, 0])).to.eql(1);
        expect(geo.distance([0, 0], [0, 0])).to.eql(0);
    });

    it('extendLine', () => {
        expect(geo.extendLine([[0, 0], [0, 2]], 1)).to.eql([0, 3]);
        expect(geo.extendLine([[0, 0], [0, 2]], 0)).to.eql([0, 2]);
        expect(geo.extendLine([[0, 0], [0, 2]], -1)).to.eql([0, 1]);
        expect(geo.extendLine([[1, 2], [3, 4]], 5)).to.be.deepCloseTo([6.536, 7.536], 0.0005);

        expect(geo.extendLine([[0, 0], [0, 2]], -2)).to.eql([0, 0]);
        expect(geo.extendLine([[0, 0], [0, 2]], -3)).to.eql([0, -1]);
    });

    it('isOnBorder', () => {
        const border: Box = [1, 2, 5, 6]; // [x, y, width, height]

        // basic
        expect(geo.isOnBorder([1, 2], border)).to.be.true;
        expect(geo.isOnBorder([3, 2], border)).to.be.true;
        expect(geo.isOnBorder([5, 8], border)).to.be.true;
        expect(geo.isOnBorder([0, 0], border)).to.be.false;
        expect(geo.isOnBorder([3, 3], border)).to.be.false;
    });

    it('closestPointOnBorder', () => {
        const border: Box = [1, 2, 5, 6]; // [x, y, width, height]

        // corners
        expect(geo.closestPointOnBorder([1, 2], border)).to.eql([1, 2]);
        expect(geo.closestPointOnBorder([6, 2], border)).to.eql([6, 2]);
        expect(geo.closestPointOnBorder([6, 8], border)).to.eql([6, 8]);
        expect(geo.closestPointOnBorder([1, 8], border)).to.eql([1, 8]);

        // sides
        expect(geo.closestPointOnBorder([2, 2], border)).to.eql([2, 2]);
        expect(geo.closestPointOnBorder([6, 3], border)).to.eql([6, 3]);
        expect(geo.closestPointOnBorder([5, 8], border)).to.eql([5, 8]);
        expect(geo.closestPointOnBorder([1, 7], border)).to.eql([1, 7]);

        // inside close to a side
        expect(geo.closestPointOnBorder([4, 3], border)).to.eql([4, 2]);
        expect(geo.closestPointOnBorder([5, 5], border)).to.eql([6, 5]);
        expect(geo.closestPointOnBorder([4, 7], border)).to.eql([4, 8]);
        expect(geo.closestPointOnBorder([2, 5], border)).to.eql([1, 5]);

        // a bit inside a corder
        // equidistant from two sides so it doesn't really matter which but make sure its deterministic
        expect(geo.closestPointOnBorder([2, 3], border)).to.eql([1, 3]);
        expect(geo.closestPointOnBorder([5, 3], border)).to.eql([6, 3]);
        expect(geo.closestPointOnBorder([5, 7], border)).to.eql([6, 7]);
        expect(geo.closestPointOnBorder([2, 7], border)).to.eql([1, 7]);

        const square: Box = [-2, -2, 4, 4]; // [x, y, width, height]
        expect(geo.closestPointOnBorder([-1, -1.5], square)).to.eql([-1, -2]);
        // dead center (doesn't matter which side really)
        expect(geo.closestPointOnBorder([0, 0], square)).to.eql([-2, 0]);

        expect(() => geo.closestPointOnBorder([0, 0], border)).to.throw("Point [0,0] is outside border [1,2,5,6]");
    });

    it('moveAlongBorder', () => {
        const border: Box = [1, 2, 5, 6]; // [x, y, width, height]

        // basic
        expect(geo.moveAlongBorder([1, 5], 1, border)).to.eql([1, 6]);
        expect(geo.moveAlongBorder([1, 5], -1, border)).to.eql([1, 4]);
        expect(geo.moveAlongBorder([3, 8], 1, border)).to.eql([4, 8]);
        expect(geo.moveAlongBorder([3, 8], -1, border)).to.eql([2, 8]);
        expect(geo.moveAlongBorder([6, 6], 1, border)).to.eql([6, 5]);
        expect(geo.moveAlongBorder([6, 6], -1, border)).to.eql([6, 7]);
        expect(geo.moveAlongBorder([4, 2], 1, border)).to.eql([3, 2]);
        expect(geo.moveAlongBorder([4, 2], -1, border)).to.eql([5, 2]);

        // corners
        expect(geo.moveAlongBorder([1, 2], 1, border)).to.eql([1, 3]);
        expect(geo.moveAlongBorder([1, 8], 1, border)).to.eql([2, 8]);
        expect(geo.moveAlongBorder([6, 8], 1, border)).to.eql([6, 7]);
        expect(geo.moveAlongBorder([6, 2], 1, border)).to.eql([5, 2]);

        expect(geo.moveAlongBorder([1, 2], -1, border)).to.eql([2, 2]);
        expect(geo.moveAlongBorder([1, 8], -1, border)).to.eql([1, 7]);
        expect(geo.moveAlongBorder([6, 8], -1, border)).to.eql([5, 8]);
        expect(geo.moveAlongBorder([6, 2], -1, border)).to.eql([6, 3]);

        // to corner
        expect(geo.moveAlongBorder([2, 2], 1, border)).to.eql([1, 2]);
        expect(geo.moveAlongBorder([2, 8], -1, border)).to.eql([1, 8]);
        expect(geo.moveAlongBorder([5, 8], 1, border)).to.eql([6, 8]);
        expect(geo.moveAlongBorder([5, 2], -1, border)).to.eql([6, 2]);

        // zero
        expect(geo.moveAlongBorder([1, 2], 0, border)).to.eql([1, 2]);
        expect(geo.moveAlongBorder([1, 5], 0, border)).to.eql([1, 5]);

        // around corner
        expect(geo.moveAlongBorder([2, 2], 2, border)).to.eql([1, 3]);
        expect(geo.moveAlongBorder([1, 7], 2, border)).to.eql([2, 8]);
        expect(geo.moveAlongBorder([5, 8], 2, border)).to.eql([6, 7]);
        expect(geo.moveAlongBorder([6, 3], 2, border)).to.eql([5, 2]);

        expect(geo.moveAlongBorder([1, 3], -2, border)).to.eql([2, 2]);
        expect(geo.moveAlongBorder([2, 8], -2, border)).to.eql([1, 7]);
        expect(geo.moveAlongBorder([6, 7], -2, border)).to.eql([5, 8]);
        expect(geo.moveAlongBorder([5, 2], -2, border)).to.eql([6, 3]);

        // loop de loop
        expect(geo.moveAlongBorder([1, 3], 28, border)).to.eql([2, 8]);
        expect(geo.moveAlongBorder([2, 8], -28, border)).to.eql([1, 3]);

        expect(() => geo.moveAlongBorder([0, 0], 1, border)).to.throw("Point [0,0] is not on border [1,2,5,6]");
        expect(() => geo.moveAlongBorder([10, 10], 1, border)).to.throw("Point [10,10] is not on border [1,2,5,6]");
        expect(() => geo.moveAlongBorder([1, 10], 1, border)).to.throw("Point [1,10] is not on border [1,2,5,6]");
    });

    it('snap', () => {
        expect(geo.snap(7, 3)).to.eql(6);
        expect(geo.snap(7, 2)).to.eql(8);
        expect(geo.snap(7, -2)).to.eql(8);
        expect(geo.snap(1.0001, 1)).to.eql(1);
        expect(geo.snap(-6.3, 0.5)).to.eql(-6.5);
        expect(geo.snap(7.35, 0.2)).to.eql(7.4);
        expect(geo.snap(16, 4)).to.eql(16);
        expect(geo.snap(0, 4)).to.eql(0);
        expect(geo.snap(1.5, 4)).to.eql(0);
        expect(geo.snap(17, 1)).to.eql(17);
        expect(geo.snap(17.3, 1)).to.eql(17);
        expect(geo.snap(10.3, 0)).to.eql(10.3);
    });

    it('normalizeAngle', () => {
        // default center 0 to get [-PI, PI)
        expect(geo.normalizeAngle(1)).to.eql(1);
        expect(geo.normalizeAngle(0)).to.eql(0);
        expect(geo.normalizeAngle(Math.PI)).to.eql(-Math.PI);
        expect(geo.normalizeAngle(-Math.PI)).to.eql(-Math.PI);
        expect(geo.normalizeAngle(2*Math.PI)).to.eql(0);
        expect(geo.normalizeAngle(-2*Math.PI)).to.eql(0);
        expect(geo.normalizeAngle(3*Math.PI)).to.eql(-Math.PI);
        expect(geo.normalizeAngle(-3*Math.PI)).to.eql(-Math.PI);
        expect(geo.normalizeAngle(3.3*Math.PI)).to.eql(-0.7 * Math.PI);
        expect(geo.normalizeAngle(7.3*Math.PI)).to.be.closeTo(-0.7 * Math.PI, 1e-6);

        // center PI to get [0, 2*PI)
        expect(geo.normalizeAngle(1, Math.PI)).to.eql(1);
        expect(geo.normalizeAngle(0, Math.PI)).to.eql(0);
        expect(geo.normalizeAngle(Math.PI, Math.PI)).to.eql(Math.PI);
        expect(geo.normalizeAngle(-Math.PI, Math.PI)).to.eql(Math.PI);
        expect(geo.normalizeAngle(2*Math.PI, Math.PI)).to.eql(0);
        expect(geo.normalizeAngle(-2*Math.PI, Math.PI)).to.eql(0);
        expect(geo.normalizeAngle(3*Math.PI, Math.PI)).to.eql(Math.PI);
        expect(geo.normalizeAngle(-3*Math.PI, Math.PI)).to.eql(Math.PI);
        expect(geo.normalizeAngle(3.3*Math.PI, Math.PI)).to.eql(1.3 * Math.PI);
        expect(geo.normalizeAngle(7.3*Math.PI, Math.PI)).to.be.closeTo(1.3 * Math.PI, 1e-6);
    });

    it('polarToRect', () => {
        expect(geo.polarToRect(Math.PI/2, 4)).to.be.deepCloseTo([0, 4]);
        expect(geo.polarToRect(Math.PI/2, 4, [1, 2])).to.be.deepCloseTo([1, 6]);

        expect(geo.polarToRect(Math.PI/4, 1)).to.be.deepCloseTo([Math.SQRT2/2, Math.SQRT2/2]);

        expect(geo.polarToRect(-Math.PI, 4)).to.deepCloseTo([-4, 0]);
        expect(geo.polarToRect(-3 * Math.PI, 4)).to.deepCloseTo([-4, 0]);

        expect(geo.polarToRect(0, 4)).to.deepCloseTo([4, 0]);
        expect(geo.polarToRect(2*Math.PI, 4)).to.deepCloseTo([4, 0]);

        expect(geo.polarToRect(0, 0)).to.deepCloseTo([0, 0]);
        expect(geo.polarToRect(0, 0, [1, 1])).to.deepCloseTo([1, 1]);
    });

    it('snapAngle', () => {
        expect(geo.snapAngle(0, Math.PI/2)).to.be.closeTo(0, 1e-8);
        expect(geo.snapAngle(0.4, Math.PI/2)).to.be.closeTo(0, 1e-8);
        expect(geo.snapAngle(1.5, Math.PI/2)).to.be.closeTo(Math.PI/2, 1e-8);
        expect(geo.snapAngle(3.4*Math.PI, Math.PI/2)).to.be.closeTo(1.5*Math.PI, 1e-8);
        expect(geo.snapAngle(-3.4*Math.PI, Math.PI/2)).to.be.closeTo(0.5*Math.PI, 1e-8);
        expect(geo.snapAngle(Math.PI/4, Math.PI/2)).to.be.closeTo(Math.PI/2, 1e-8);

        // offset
        expect(geo.snapAngle(0.01, Math.PI/4, Math.PI/8)).to.be.closeTo(Math.PI/8, 1e-8);
        expect(geo.snapAngle(2.01*Math.PI, Math.PI/4, Math.PI/8)).to.be.closeTo(Math.PI/8, 1e-8);
    });

    it('unitVector', () => {
        expect(geo.unitVector([0, 1])).to.eql([0, 1]);
        expect(geo.unitVector([0, 5])).to.eql([0, 1]);
        expect(geo.unitVector([5, 0])).to.eql([1, 0]);
        expect(geo.unitVector([1, 1])).to.be.deepCloseTo([Math.SQRT2/2, Math.SQRT2/2]);

        expect(geo.unitVector([5, 0, 5])).to.be.deepCloseTo([Math.SQRT2/2, 0, Math.SQRT2/2]);
        expect(geo.unitVector([6])).to.eql([1]);

        expect(geo.unitVector([0, 0])).to.eql([NaN, NaN]);
    });

    it('midpoint', () => {
        expect(geo.midpoint([0, 1], [0, 3])).to.eql([0, 2]);
        expect(geo.midpoint([1, 0], [3, 0])).to.eql([2, 0]);
        expect(geo.midpoint([1, 1], [-3, -3])).to.eql([-1, -1]);
        expect(geo.midpoint([1, 1], [7, 4])).to.eql([4, 2.5]);
        expect(geo.midpoint([1, 1], [1, 1])).to.eql([1, 1]);
        expect(geo.midpoint([0, 0], [0, 0])).to.eql([0, 0]);
    });

    it('slope', () => {
        expect(geo.slope([0, 0], [1, 1])).to.eql(1);
        expect(geo.slope([1, 1], [0, 0])).to.eql(1);
        expect(geo.slope([0, 0], [-1, 1])).to.eql(-1);
        expect(geo.slope([0, 0], [-1, -1])).to.eql(1);

        expect(geo.slope([5, 6], [2, 1])).to.eql(5/3);

        expect(geo.slope([0, 0], [1, 0])).to.eql(0);
        expect(geo.slope([0, 0], [0, 1])).to.eql(Infinity);
    });
});
