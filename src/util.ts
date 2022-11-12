import { FileType, AnyFile } from "./shared";

/**
 * Returns the extension from a file name excluding the ".", or "" if there is none.
 * Hidden files count as having no extension.
 */
export function getExtension(filename: string): string {
    filename = filename.split("/").at(-1)! // remove any path
    const dotPos = filename.lastIndexOf(".");
    return dotPos > 0 ? filename.slice(dotPos + 1) : "";
}

/**
 * Filters a tree structure. Can't remove the root node.
 */
export function filterFileTree<T extends AnyFile>(root: T, condition: (node: AnyFile) => boolean): T {
    if (root.type == FileType.Directory) {
        return { ...root, children: root.children.filter(condition).map(child => filterFileTree(child, condition)) };
    } else {
        return root;
    }
}

/**
 * Converts a value to a normalized JSON string, sorting object keys.
 */
export function normalizedJSONStringify(val: any) {
    const replacer = (key: string, val: any) => {
        if (typeof val == 'object' && val !== null && !Array.isArray(val)) {
            return Object.keys(val).sort().reduce<Record<string, any>>((o, k) => { o[k] = val[k]; return o }, {});
        } else {
            return val;
        }
    }

    return JSON.stringify(val, replacer)
}

/**
 * Converts i into a number in the range [0, len) such that len + 1 = 0 and -1 = len
 * Can be used to convert a number into a valid index in an array with circular semantics
 */
export function loopIndex(i: number, len: number): number {
    return (i >= 0) ? i % len : len + (i + 1) % len - 1;
}

/** Makes a set of keys on type optional */
export type OptionalKeys<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>