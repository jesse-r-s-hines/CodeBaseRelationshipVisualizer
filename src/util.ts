import { FileType, AnyFile } from "./privateTypes";

/**
 * Returns the extension from a file name excluding the ".", or "" if there is none.
 * Hidden files count as having no extension.
 */
export function getExtension(filename: string): string {
    filename = filename.split("/").at(-1)!; // remove any path
    const dotPos = filename.lastIndexOf(".");
    return dotPos > 0 ? filename.slice(dotPos + 1) : "";
}

/**
 * Filters a tree structure. Can't remove the root node.
 * Pass a condition predicate, which will be passed the file object, and a string path relative to root.
 * The condition predicate will be called on each file AFTER its children have been filtered.
 */
export function filterFileTree<T extends AnyFile>(
    root: T,
    condition: (node: AnyFile, path: string) => boolean,
    path = ""
): T {
    // Can't use path module in webview. TODO consider how we're handling windows paths.
    const joinPath = (path: string, c: AnyFile) => path ? `${path}/${c.name}` : c.name;

    if (root.type == FileType.Directory) {
        return {
            ...root,
            children: root.children
                // map first so condition is run on already filtered directories
                .map(child => filterFileTree(child, condition, joinPath(path, child)))
                .filter(child => condition(child, joinPath(path, child)))
        };
    } else {
        return root;
    }
}

/** Gets a path and all its ancestors, e.g. "/a/b/c" will return ["/a/b/c", "/a/b", "/a", "/"] */
export function pathAncestors(path: string): string[] {
    if (path == "") {
        return [""];
    } else {
        const parts = path.split(/[/\\]/).filter((p, i) => !!p || i == 0);
        return parts
            .map((s, i, arr) => {
                const slice = arr.slice(0, i + 1);
                return (slice.length == 1 && slice[0] == "") ? "/" : slice.join("/");
            })
            .reverse();
    }
}

/**
 * Converts a value to a normalized JSON string, sorting object keys.
 */
export function normalizedJSONStringify(val: any) {
    const replacer = (key: string, val: any) => {
        if (typeof val == 'object' && val !== null && !Array.isArray(val)) {
            return Object.keys(val).sort().reduce<Record<string, any>>((o, k) => { o[k] = val[k]; return o; }, {});
        } else {
            return val;
        }
    };

    return JSON.stringify(val, replacer);
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