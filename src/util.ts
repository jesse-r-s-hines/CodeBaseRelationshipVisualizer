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

/**
 * Converts a value to a normalized JSON string, sorting object keys.
 */
export function normalizedJSONStringify(val: any) {
    const replacer = (key: string, val: any) => {
        if (typeof val == 'object' && !Array.isArray(val)) {
            return Object.keys(val).sort().reduce<Record<string, any>>((o, k) => { o[k] = val[k]; return o }, {});
        } else {
            return val;
        }
    }

    return JSON.stringify(val, replacer)
}