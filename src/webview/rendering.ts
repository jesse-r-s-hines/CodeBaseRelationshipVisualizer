import { sha256 } from 'js-sha256';
import _ from "lodash"

export type Point = [number, number]
/** [x, y, width, height] */
export type Box = [number, number, number, number]

/**
 * If el's text is wider than width, cut it and add an ellipsis until if fits. Returns the new text in the node. If
 * the text won't fit at all, sets the text to empty. There are pure CSS ways of doing this, but they don't work in
 * SVGs unless we do a foreignObject.
 */
export function ellipsisText(el: SVGTextContentElement, width: number, height = Infinity, padding = 0): string {
    const [availableWidth, availableHeight] = [width - 2 * padding, height - 2 * padding];
    const fontHeight = parseInt(getComputedStyle(el).fontSize, 10);

    if (fontHeight > availableHeight) {
        el.textContent = "";
    } else if (el.getComputedTextLength() > availableWidth) { // need to crop it
        const originalText = el.textContent ?? "";

        // binary search to find the optimal length
        let fits = 0, doesntFit = originalText.length;
        while (fits + 1 < doesntFit) { // go until adding one more character doesn't fit
            const mid = Math.floor((fits + doesntFit) / 2);
            el.textContent = originalText.slice(0, mid) + "...";

            if (el.getComputedTextLength() > availableWidth) {
                doesntFit = mid;
            } else { // length <= width
                fits = mid;
            }
        }

        if (fits > 0) {
            el.textContent = originalText.slice(0, fits) + "...";
        } else {
            el.textContent = ""; // text can't fit at all
        }
    }

    return el.textContent ?? "";
}

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
 * Converts an arbitrary string key into a unique html id containing only alphanumeric characters, Using
 * same key again will return the same id. Optionally add a prefix to the generated id.
 */
export function uniqId(key: string, prefix = "") {
    return `${prefix}${sha256(key)}`;
}

export function getRect(el: Element): [number, number] {
    const rect = el.getBoundingClientRect();
    return [rect.width, rect.height];
}

/**
 * Returns the closest point on the rectangle border to `p`.
 * @param p A point inside the border.
 * @param border [x, y, width, height]
 */
export function closestPointOnBorder([x, y]: Point, border: Box): Point {
    const [bx, by, width, height] = border
    const [distLeft, distRight, distTop, distBottom] = [x - bx, (bx + width) - x, y - by, (by + height) - by]
    const min = Math.min(distLeft, distRight, distTop, distBottom)

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

