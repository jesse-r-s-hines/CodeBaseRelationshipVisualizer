import _ from "lodash"

export type Point = [number, number]
/** [x, y, width, height] */
export type Box = [number, number, number, number]

/** Returns the distance between two points */
export function distance(a: Point, b: Point): number {
    return Math.abs(Math.hypot(a[0] - b[0], a[1] - b[1]));
}

/** Returns a point that is `dist` past end on the line going through start and end. Dist can be negative. */
export function extendLine([start, end]: [Point, Point], dist: number): Point {
    const origLen = distance(start, end);
    const newLen = origLen + dist;

    return [
        start[0] + (end[0] - start[0]) / origLen * newLen,
        start[1] + (end[1] - start[1]) / origLen * newLen,
    ];
}

/**
 * Returns the closest point on the rectangle border to `p`.
 * @param p A point inside the border.
 * @param border [x, y, width, height]
 */
export function closestPointOnBorder([x, y]: Point, border: Box): Point {
    const [bx, by, width, height] = border
    const [distLeft, distRight, distTop, distBottom] = [x - bx, (bx + width) - x, y - by, (by + height) - y]
    const min = Math.min(distLeft, distRight, distTop, distBottom)
    if (min < 0) throw Error(`Point ${JSON.stringify([x, y])} is outside border ${JSON.stringify(border)}`)

    if (min == distLeft) {
        return [bx, y]
    } else if (min == distRight) {
        return [bx + width, y]
    } else if (min == distTop) {
        return [x, by]
    } else { // if (min == distBottom)
        return [x, by + height]
    }
}

/**
 * Returns the point d distance away from [x, y] clockwise around the border. [x, y] must be on border.
 */
export function moveAlongBorder([x, y]: Point, dist: number, border: Box): Point {
    const [left, bottom, width, height] = border
    const [right, top] = [left + width, bottom + height]

    if (x < left || right < x || y < bottom || top < y) {
        throw Error(`${[x, y]} is outside border ${border}`)
    }

    while (dist != 0) {
        let [newX, newY] = [x, y]
        if (x == left) {
            newY = _.clamp(y + dist, bottom, left)
        } else if (y == top) {
            newX = _.clamp(x + dist, left, right)
        } else if (x == right) {
            newY = _.clamp(y - dist, bottom, left)
        } else if (y == bottom) {
            newX = _.clamp(x - dist, left, right)
        } else {
            throw Error(`${[x, y]} is inside border`) // we 
        }

        dist -= Math.sign(dist) * (Math.abs(newX - x) + Math.abs(newY - y));

        [x, y] = [newX, newY];
    }

    return [x, y]
}

/**
 * Snaps a number to be divisible by delta
 */
export function snap(x: number, delta: number) {
    return delta * Math.round(x / delta);
}

/**
 * Normalize radians around a center value (default will be range [-PI, PI])
 * Use center PI to get [0, 2PI)
 */
export function normalizeAngle(angle: number, center: number = 0) {
    // See https://stackoverflow.com/questions/24234609
    return angle - (2*Math.PI) * Math.floor((angle + Math.PI - center) / (2*Math.PI));
}

/** Converts polar coordinates to rectangular */
export function polarToRect(theta: number, r: number, center: Point = [0, 0]): Point {
    return [r * Math.cos(theta) + center[0], r * Math.sin(theta) + center[1]]
}

/*
 * Snaps angle to the nearest angle that is in the series created by offset + delta * i for each integer i.
 * Delta should be a positive angle that divides a circle evenly.
 * Returns an angle in the range [0, 2*PI]
 */
export function snapAngle(angle: number, delta: number, offset: number = 0) {
    angle = normalizeAngle(angle - offset, Math.PI); // [0, 2PI]
    const snapped = delta * Math.round(angle / delta)
    return normalizeAngle(snapped + offset, Math.PI);
}

/**
 * Calculates a unit vector
 */
export function unitVector(vector: number[]): number[] {
    const len = Math.hypot(...vector);
    return vector.map(n => n / len);
}

/** Returns the midpoint between two points */
export function midpoint(a: Point, b: Point): Point {
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
}

/** Returns the slope of the line between two points */
export function slope(a: Point, b: Point): number {
    return (b[1] - a[1]) / (b[0] - a[0])
}
