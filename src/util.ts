import { FileType, AnyFile } from "./shared";

/**
 * Returns the extension from a file name excluding the ".", or "" if there is none.
 * Hidden files count as having no extension
 */
export function getExtension(filename: string): string {
    const dotPos = filename.lastIndexOf(".");
    return dotPos > 0 ? filename.slice(dotPos + 1) : ""; // TODO hidden files and such?
}

/** Filters a tree structure */
export function filterFileTree<T extends AnyFile>(root: T, condition: (node: AnyFile) => boolean): T {
    if (root.type == FileType.Directory) {
        return { ...root, children: root.children.filter(condition).map(child => filterFileTree(child, condition)) };
    } else {
        return root;
    }
}

/** Limits the number into the given range (inclusive) */
export function clamp(val: number, min: number, max: number) {
    return Math.max(min, Math.min(val, max));
}

/** Lazily map and filter an iterable */
export class Lazy<T> implements Iterable<T> {
    #iterable: Iterable<T>
    constructor(iterable: Iterable<T>) {
        this.#iterable = iterable;
    }

    [Symbol.iterator]() {
        return this.#iterable[Symbol.iterator]();
    }

    map<U>(func: (x: T) => U): Lazy<U> {
        return new Lazy(function*(iterable) {
            for (const x of iterable) {
                yield func(x);
            }
        }(this.#iterable));
    }

    filter(func: (x: T) => boolean): Lazy<T> {
        return new Lazy(function*(iterable) {
            for (const x of iterable) {
                if (func(x)) {
                    yield x;
                }
            }
        }(this.#iterable));
    }
}
