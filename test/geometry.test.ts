import { expect } from 'chai';
import * as geo from '../src/webview/geometry';
import { Point, Box } from '../src/webview/geometry';


describe("Test geometry.ts", () => {
    it('distance', () => {
        expect(geo.distance([1, 2], [3, 4])).to.be.closeTo(2.828, 0.0005)
        expect(geo.distance([3, 4], [1, 2])).to.be.closeTo(2.828, 0.0005)
        expect(geo.distance([0, 0], [1, 0])).to.eql(1)
        expect(geo.distance([0, 0], [0, 0])).to.eql(0)
    })

    it('extendLine', () => {
        expect(geo.extendLine([[0, 0], [0, 2]], 1)).to.eql([0, 3]);
        expect(geo.extendLine([[0, 0], [0, 2]], 0)).to.eql([0, 2]);
        expect(geo.extendLine([[0, 0], [0, 2]], -1)).to.eql([0, 1]);
        const p = geo.extendLine([[1, 2], [3, 4]], 5)
        expect(p[0]).to.be.closeTo(6.536, 0.0005);
        expect(p[1]).to.be.closeTo(7.536, 0.0005);

        expect(geo.extendLine([[0, 0], [0, 2]], -2)).to.eql([0, 0]);
        expect(geo.extendLine([[0, 0], [0, 2]], -3)).to.eql([0, -1]);
    })

    it('isOnBorder', () => {
        let border: Box = [1, 2, 5, 6] // [x, y, width, height]

        // basic
        expect(geo.isOnBorder([1, 2], border)).to.be.true;
        expect(geo.isOnBorder([3, 2], border)).to.be.true;
        expect(geo.isOnBorder([5, 8], border)).to.be.true;
        expect(geo.isOnBorder([0, 0], border)).to.be.false;
        expect(geo.isOnBorder([3, 3], border)).to.be.false;
    })

    it('closestPointOnBorder', () => {
        let border: Box = [1, 2, 5, 6] // [x, y, width, height]

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

        let square: Box = [-2, -2, 4, 4] // [x, y, width, height]
        expect(geo.closestPointOnBorder([-1, -1.5], square)).to.eql([-1, -2]);
        // dead center (doesn't matter which side really)
        expect(geo.closestPointOnBorder([0, 0], square)).to.eql([-2, 0]);

        expect(() => geo.closestPointOnBorder([0, 0], border)).to.throw("Point [0,0] is outside border [1,2,5,6]")
    })
})
