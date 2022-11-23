import { expect } from 'chai';
import { describe, test } from "mocha";
import { AnyFile, FileType } from '../src/shared';
import * as util from '../src/util';
import _ from "lodash";

describe("Test utils.ts", () => {
    it('test getExtension', () => {
        expect(util.getExtension("a.txt")).to.eql("txt");
        expect(util.getExtension("path/to/a.txt.zip")).to.eql("zip");

        expect(util.getExtension("a/path/to/file")).to.eql("");
        expect(util.getExtension("a/path/folder.txt/file")).to.eql("");
    
        expect(util.getExtension("")).to.eql("");
        expect(util.getExtension(".gitignore")).to.eql("");
        expect(util.getExtension(".")).to.eql("");
        expect(util.getExtension("..")).to.eql("");
        expect(util.getExtension("a.")).to.eql("");
    });

    describe('test filterFileTree', () => {
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
        };
        const empty: AnyFile = {name: "empty", type: FileType.Directory, children: []};
        const file: AnyFile = {name: "empty", type: FileType.File, size: 4};
    
        it('basic', () => {
            expect(util.filterFileTree(tree, f => true)).to.eql(tree);
            expect(util.filterFileTree(tree, f => ['a', 'b', 'c'].includes(f.name))).to.eql({
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
        });
    
        it("can't remove root node", () => {
            expect(util.filterFileTree(tree, f => false)).to.eql({name: "a", type: FileType.Directory, children: []});
            expect(util.filterFileTree(empty, f => true)).to.eql(empty);
            expect(util.filterFileTree(empty, f => false)).to.eql(empty);
            expect(util.filterFileTree(file, f => true)).to.eql(file);
            expect(util.filterFileTree(file, f => false)).to.eql(file);
        });

        it("paths", () => {
            let paths: string[] = [];
            const result = util.filterFileTree(tree, (f, path) => {
                paths.push(path);
                return true;
            });
            paths = _.sortBy(paths);
            
            expect(paths).to.eql([
                "b",
                "b/c",
                "b/d",
                "e",
                "f",
            ]);


            expect(util.filterFileTree(tree, f => false)).to.eql({name: "a", type: FileType.Directory, children: []});
        });
    });


    it('test normalizedJSONStringify', () => {
        expect(util.normalizedJSONStringify(1)).to.eql('1');
        expect(util.normalizedJSONStringify('a')).to.eql('"a"');
        expect(util.normalizedJSONStringify(null)).to.eql('null');
        expect(util.normalizedJSONStringify([1, 2, 3])).to.eql('[1,2,3]');
        expect(util.normalizedJSONStringify({a: 2, b: 1})).to.eql('{"a":2,"b":1}');
        expect(util.normalizedJSONStringify({b: 1, a: 2})).to.eql('{"a":2,"b":1}');
        expect(util.normalizedJSONStringify({})).to.eql('{}');
        expect(util.normalizedJSONStringify({
            b: 1,
            a: {d: [1, 2, 3], c: null}
        })).to.eql('{"a":{"c":null,"d":[1,2,3]},"b":1}');
    });
    

    it('test loopIndex', () => {
        expect(util.loopIndex(3, 5)).to.eql(3);
        expect(util.loopIndex(0, 5)).to.eql(0);
        expect(util.loopIndex(5, 5)).to.eql(0);
        expect(util.loopIndex(6, 5)).to.eql(1);
        expect(util.loopIndex(12, 5)).to.eql(2);
        expect(util.loopIndex(-1, 5)).to.eql(4);
        expect(util.loopIndex(-2, 5)).to.eql(3);
        expect(util.loopIndex(-5, 5)).to.eql(0);
        expect(util.loopIndex(-7, 5)).to.eql(3);
        expect(util.loopIndex(-12, 5)).to.eql(3);

        expect(util.loopIndex(0, 1)).to.eql(0);
        expect(util.loopIndex(1, 1)).to.eql(0);
        expect(util.loopIndex(-1, 1)).to.eql(0);

        expect(util.loopIndex(0, 0)).to.be.NaN;
    });
});



