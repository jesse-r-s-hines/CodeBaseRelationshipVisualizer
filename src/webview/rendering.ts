import { sha256 } from 'js-sha256';

export type Point = [number, number]

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

/** Crops both ends of the line from a to b .*/
export function cropLine([a, b]: [Point, Point], cropStart: number, cropEnd: number): [Point, Point] {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const origDist = Math.hypot(dx, dy);
    return [
        [a[0] + cropStart * dx / origDist, a[1] + cropStart * dy / origDist],
        [b[0] - cropEnd * dx / origDist, b[1] - cropEnd * dy / origDist],
    ];
}

/**
 * Converts an arbitrary string key into a unique html id containing only alphanumeric characters, Using
 * same key again will return the same id. Optionally add a prefix to the generated id.
 */
export function uniqId(key: string, prefix = "") {
    return `${prefix}${sha256(key)}`;
}
