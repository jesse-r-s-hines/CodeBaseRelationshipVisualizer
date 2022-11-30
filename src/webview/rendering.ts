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

export function getRect(el: Element): [number, number] {
    const rect = el.getBoundingClientRect();
    return [rect.width, rect.height];
}
