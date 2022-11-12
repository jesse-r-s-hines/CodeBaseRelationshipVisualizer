import {describe, expect, test} from '@jest/globals';
import { AnyFile, FileType } from '../src/shared';
import * as util from '../src/util';

test('getExtension', () => {
    expect(util.getExtension("a.txt")).toBe("txt");
    expect(util.getExtension("path/to/a.txt.zip")).toBe("zip");

    expect(util.getExtension("a/path/to/file")).toBe("");
    expect(util.getExtension("a/path/folder.txt/file")).toBe("");

    expect(util.getExtension("")).toBe("");
    expect(util.getExtension(".gitignore")).toBe("");
    expect(util.getExtension(".")).toBe("");
    expect(util.getExtension("..")).toBe("");
    expect(util.getExtension("a.")).toBe("");
});

test('filterFileTree', () => {
    const tree: AnyFile = {
        name: "a",
        type: FileType.Directory,
        children: [
            {
                name: "b",
                type: FileType.Directory,
                children: [
                    {name: "c", type: FileType.File, size: 1},
                    {name: "d", type: FileType.File, size: 2}
                ],
            },
            {name: "e", type: FileType.File, size: 3},
            {name: "f", type: FileType.Directory, children: []},
        ],
    }
    const empty: AnyFile = {name: "empty", type: FileType.Directory, children: []}
    const file: AnyFile = {name: "empty", type: FileType.File, size: 4}

    expect(util.filterFileTree(tree, f => true)).toEqual(tree);
    expect(util.filterFileTree(tree, f => ['a', 'b', 'c'].includes(f.name))).toEqual({
        name: "a",
        type: FileType.Directory,
        children: [
            {
                name: "b",
                type: FileType.Directory,
                children: [{name: "c", type: FileType.File, size: 1}],
            },
        ],
    });

    // Can't remove root
    expect(util.filterFileTree(tree, f => false)).toEqual({name: "a", type: FileType.Directory, children: []});
    expect(util.filterFileTree(empty, f => true)).toEqual(empty);
    expect(util.filterFileTree(empty, f => false)).toEqual(empty);
    expect(util.filterFileTree(file, f => true)).toEqual(file);
    expect(util.filterFileTree(file, f => false)).toEqual(file);
});


test('normalizedJSONStringify', () => {
    expect(util.normalizedJSONStringify(1)).toEqual('1');
    expect(util.normalizedJSONStringify('a')).toEqual('"a"');
    expect(util.normalizedJSONStringify(null)).toEqual('null');
    expect(util.normalizedJSONStringify([1, 2, 3])).toEqual('[1,2,3]');
    expect(util.normalizedJSONStringify({a: 2, b: 1})).toEqual('{"a":2,"b":1}');
    expect(util.normalizedJSONStringify({b: 1, a: 2})).toEqual('{"a":2,"b":1}');
    expect(util.normalizedJSONStringify({})).toEqual('{}');
    expect(util.normalizedJSONStringify({
        b: 1,
        a: {d: [1, 2, 3], c: null}
    })).toEqual('{"a":{"c":null,"d":[1,2,3]},"b":1}');
});


test('loopIndex', () => {
    expect(util.loopIndex(3, 5)).toEqual(3);
    expect(util.loopIndex(0, 5)).toEqual(0);
    expect(util.loopIndex(5, 5)).toEqual(0);
    expect(util.loopIndex(6, 5)).toEqual(1);
    expect(util.loopIndex(12, 5)).toEqual(2);
    expect(util.loopIndex(-1, 5)).toEqual(4);
    expect(util.loopIndex(-2, 5)).toEqual(3);
    expect(util.loopIndex(-5, 5)).toEqual(0);
    expect(util.loopIndex(-7, 5)).toEqual(3);
    expect(util.loopIndex(-12, 5)).toEqual(3);

    expect(util.loopIndex(0, 1)).toEqual(0);
    expect(util.loopIndex(1, 1)).toEqual(0);
    expect(util.loopIndex(-1, 1)).toEqual(0);

    expect(util.loopIndex(0, 0)).toBeNaN();
});
