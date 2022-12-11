import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
chai.use(chaiAsPromised);
import { describe, test } from "mocha";
import * as vscode from 'vscode';
import { Uri } from 'vscode';
import * as fs from 'fs';
import _ from 'lodash';

import { Directory, FileType } from '../../src/types';
import * as fileHelper from '../../src/fileHelper';

// I can't find a built-in way to get workspaceFolder. __dirname is .../CBRV/dist/test/test/integration
const workspaceFolder = Uri.file(__dirname.split("/").slice(0, -4).join("/"));
const samples = Uri.joinPath(workspaceFolder, '/test/sample-codebases');
const minimal = Uri.joinPath(samples, 'minimal');
const symlinks = Uri.joinPath(samples, 'symlinks');
const empty = Uri.joinPath(samples, 'empty');
if (!fs.existsSync(empty.fsPath)) {
    fs.mkdirSync(empty.fsPath); // git can't track an empty dir
}

const minimalContents: Directory = {
    name: "minimal",
    type: FileType.Directory,
    children: [
        {
            name: "A",
            type: FileType.Directory,
            children: [
                {name: "E.txt", size: 1828, type: FileType.File},
                {name: "F.txt", size: 630, type: FileType.File},
                {name: "G.md", size: 124, type: FileType.File},
            ],
        },
        {name: "C.txt", size: 1117, type: FileType.File},
        {name: "D.md", size: 841, type: FileType.File},
        {name: "Supercalifragilisticexpialidocious.py", size: 44, type: FileType.File},
        {
            name: "deoxyribonucleicAcid",
            type: FileType.Directory,
            children: [
                {name: "I", size: 1, type: FileType.File},
            ],
        }
    ]
};

const symlinkContents: Directory = {
    name: "symlinks",
    type: FileType.Directory,
    children: [
        {
            name: "A",
            type: FileType.Directory,
            children: [
                {name: "E.txt", type: FileType.File, size: 1828},
            ],
        },
        {name: "B.md", type: FileType.File, size: 870},
        {name: "C.md", type: FileType.File, size: 13},
        {
            name: "external",
            type: FileType.SymbolicLink,
            linkedType: FileType.Directory,
            link: "../minimal/deoxyribonucleicAcid/",
            resolved: Uri.joinPath(samples, "minimal/deoxyribonucleicAcid").fsPath,
        },
        {
            name: "external.md",
            type: FileType.SymbolicLink,
            linkedType: FileType.File,
            link: "../minimal/D.md",
            resolved: Uri.joinPath(samples, "minimal/D.md").fsPath, // full path since external
        },
        {
            name: "external2.md",
            type: FileType.SymbolicLink,
            linkedType: FileType.File,
            link: "../minimal/D.md",
            resolved: Uri.joinPath(samples, "minimal/D.md").fsPath, // full path since external
        },
        {
            name: "externalNested.txt",
            type: FileType.SymbolicLink,
            linkedType: FileType.File,
            link: "../minimal/deoxyribonucleicAcid/I",
            resolved: Uri.joinPath(samples, "minimal/deoxyribonucleicAcid/I").fsPath, // full path since external
        },
        {
            name: "link",
            type: FileType.SymbolicLink,
            linkedType: FileType.Directory,
            link: "A",
            resolved: "A",
        },
        {
            name: "link.md",
            type: FileType.SymbolicLink,
            linkedType: FileType.File,
            link: "B.md",
            resolved: "B.md",
        },
        {
            name: "linklink",
            type: FileType.SymbolicLink,
            linkedType: FileType.Directory,
            link: "link",
            resolved: "A",
        },
        {
            name: "linklink.md",
            linkedType: FileType.File,
            type: FileType.SymbolicLink,
            link: "link.md",
            resolved: "B.md",
        },
        {
            name: "loop",
            type: FileType.Directory,
            children: [
                {name: "file.md", type: FileType.File, size: 12},
                {
                    name: "loop",
                    type: FileType.SymbolicLink,
                    linkedType: FileType.Directory,
                    link: ".",
                    resolved: "loop",
                },
            ],
        },
    ],
};

describe('Test fileHelper', () => {
    test('getFileTree', async () => {
        let tree = await fileHelper.getFileTree(minimal);
        expect(tree).to.eql(minimalContents);

        tree = await fileHelper.getFileTree(empty);
        expect(tree).to.eql({type: FileType.Directory, name: "empty", children: []});

        tree = await fileHelper.getFileTree(symlinks);
        expect(tree).to.eql(symlinkContents);
    });

    test('listToFileTree', async () => {
        let fileList = await vscode.workspace.findFiles(new vscode.RelativePattern(minimal, '**/*'));
        let tree = await fileHelper.listToFileTree(minimal, fileList);
        expect(tree).to.eql(minimalContents);

        tree = await fileHelper.listToFileTree(empty, []);
        expect(tree).to.eql({type: FileType.Directory, name: "empty", children: []});

        fileList = [
            Uri.joinPath(minimal, 'A')
        ];
        tree = await fileHelper.listToFileTree(minimal, fileList);
        expect(tree).to.eql({
            type: FileType.Directory,
            name: "minimal",
            children: [{type: FileType.Directory, name: "A", children: []}],
        });

        fileList = [
            Uri.joinPath(minimal, 'A/E.txt')
        ];
        tree = await fileHelper.listToFileTree(minimal, fileList);
        expect(tree).to.eql({
            type: FileType.Directory,
            name: "minimal",
            children: [{
                type: FileType.Directory,
                name: "A",
                children: [{type: FileType.File, name: "E.txt", size: 1828}]
            }],
        });

        await expect(fileHelper.listToFileTree(minimal, [minimal]))
            .to.be.rejectedWith(/".*\/sample-codebases\/minimal" is not under ".*\/sample-codebases\/minimal"/);
        await expect(fileHelper.listToFileTree(minimal, [samples]))
            .to.be.rejectedWith(/".*\/sample-codebases" is not under ".*\/sample-codebases\/minimal"/);

        fileList = await vscode.workspace.findFiles(new vscode.RelativePattern(symlinks, '**/*'));
        const expected = _.cloneDeep(symlinkContents);
        const loop = expected.children.find(c => c.name == "loop")! as Directory;
        loop.children = loop.children!.filter(c => c.name != "loop"); // findFiles doesn't traverse the loop
        tree = await fileHelper.listToFileTree(symlinks, fileList);
        expect(tree).to.eql(expected);
    });

    test('getFilteredFileList and getFilteredFileListTree', async () => {
        const minimalContentsList = [
            "A/E.txt",
            "A/F.txt",
            "A/G.md",
            "C.txt",
            "D.md",
            "Supercalifragilisticexpialidocious.py",
            "deoxyribonucleicAcid/I",
        ].map(u => Uri.joinPath(minimal, u).fsPath);

        let list = await fileHelper.getFilteredFileList(minimal, '**/*');
        expect(list.map(u => u.fsPath)).to.eql(minimalContentsList);

        list = await fileHelper.getFilteredFileList(minimal, '**/*', ' '); // should be trimmed and ignored
        expect(list.map(u => u.fsPath)).to.eql(minimalContentsList);

        let tree = await fileHelper.getFilteredFileTree(minimal, '**/*');
        expect(tree).to.eql(minimalContents);

        tree = await fileHelper.getFilteredFileTree(minimal, 'A/*');
        expect(tree).to.eql({
            name: "minimal",
            type: FileType.Directory,
            children: [
                {
                    name: "A",
                    type: FileType.Directory,
                    children: [
                        {name: "E.txt", size: 1828, type: FileType.File},
                        {name: "F.txt", size: 630, type: FileType.File},
                        {name: "G.md", size: 124, type: FileType.File},
                    ],
                },
            ]
        });

        tree = await fileHelper.getFilteredFileTree(minimal, '**/*', 'A');

        tree = await fileHelper.getFilteredFileTree(minimal, '**/*', 'A, *.txt');
        expect(tree).to.eql({
            name: "minimal",
            type: FileType.Directory,
            children: [
                {name: "D.md", size: 841, type: FileType.File},
                {name: "Supercalifragilisticexpialidocious.py", size: 44, type: FileType.File},
                {
                    name: "deoxyribonucleicAcid",
                    type: FileType.Directory,
                    children: [
                        {name: "I", size: 1, type: FileType.File},
                    ],
                }
            ]
        });

        // tree = await fileHelper.getFilteredFileList(minimal, 'A/{E,F}.txt')
        // tree = await fileHelper.getFilteredFileList(minimal, 'A/*.{txt,md}, D.md')

        tree = await fileHelper.getFilteredFileTree(symlinks, 'A/**');
        expect(tree).to.eql({
            name: "symlinks",
            type: FileType.Directory,
            children: [
                {
                    name: "A",
                    type: FileType.Directory,
                    children: [
                        {name: "E.txt", size: 1828, type: FileType.File},
                    ],
                },
            ]
        });

        tree = await fileHelper.getFilteredFileTree(symlinks, 'A/**, link/**');
        expect(tree).to.eql({
            name: "symlinks",
            type: FileType.Directory,
            children: [
                {
                    name: "A",
                    type: FileType.Directory,
                    children: [
                        {name: "E.txt", size: 1828, type: FileType.File},
                    ],
                },
                {
                    name: "link",
                    type: FileType.SymbolicLink,
                    linkedType: FileType.Directory,
                    link: "A",
                    resolved: "A",
                },
            ]
        });
    });
});
