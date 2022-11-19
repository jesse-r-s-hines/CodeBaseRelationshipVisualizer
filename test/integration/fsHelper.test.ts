import { expect } from 'chai';
import { describe, test } from "mocha"
import * as vscode from 'vscode';
import { Uri } from 'vscode'
import * as fs from 'fs'

import { FileType } from '../../src/shared'
import * as fileHelper from '../../src/fileHelper'

// I can't find a built-in way to get workspaceFolder. __dirname is .../CBRV/dist/test/test/integration
const workspaceFolder = Uri.file(__dirname.split("/").slice(0, -4).join("/"))
const samples = Uri.joinPath(workspaceFolder, '/test/sample-codebases');
const minimal = Uri.joinPath(samples, 'minimal')
const empty = Uri.joinPath(samples, 'empty')
if (!fs.existsSync(empty.fsPath)) {
    fs.mkdirSync(empty.fsPath) // git can't track an empty dir
}

const minimal_contents = {
    "name": "minimal",
    "type": FileType.Directory,
    "children": [
        {
            "name": "A",
            "type": FileType.Directory,
            "children": [
                {"name": "E.txt", "size": 1828, "type": FileType.File},
                {"name": "F.txt", "size": 630, "type": FileType.File},
                {"name": "G.md", "size": 124, "type": FileType.File},
            ],
        },
        {"name": "C.txt", "size": 1117, "type": FileType.File},
        {"name": "D.md", "size": 841, "type": FileType.File},
        {"name": "Supercalifragilisticexpialidocious.py", "size": 44, "type": FileType.File},
        {
            "name": "deoxyribonucleicAcid",
            "type": FileType.Directory,
            "children": [
                {"name": "I", "size": 1, "type": FileType.File},
            ],
        }
    ]
}



describe('Test fileHelper', () => {
    test('getFileTree', async () => {
        let tree = await fileHelper.getFileTree(minimal);
        expect(tree).to.eql(minimal_contents);

        tree = await fileHelper.getFileTree(Uri.joinPath(samples, "empty"));
        expect(tree).to.eql({type: FileType.Directory, name: "empty", children: []});
    });

    test('listToFileTree', async () => {
        const includePattern = new vscode.RelativePattern(minimal, '**/*')
        let fileList = await vscode.workspace.findFiles(includePattern)
        let tree = await fileHelper.listToFileTree(minimal, fileList)
        expect(tree).to.eql(minimal_contents);

        tree = await fileHelper.listToFileTree(empty, [])
        expect(tree).to.eql({type: FileType.Directory, name: "empty", children: []});

        fileList = [
            Uri.joinPath(minimal, 'A')
        ]
        tree = await fileHelper.listToFileTree(minimal, fileList)
        expect(tree).to.eql({
            type: FileType.Directory,
            name: "minimal",
            children: [{type: FileType.Directory, name: "A", children: []}],
        });

        fileList = [
            Uri.joinPath(minimal, 'A/E.txt')
        ]
        tree = await fileHelper.listToFileTree(minimal, fileList)
        expect(tree).to.eql({
            type: FileType.Directory,
            name: "minimal",
            children: [{
                type: FileType.Directory,
                name: "A",
                children: [{type: FileType.File, name: "E.txt", size: 1828}]
            }],
        });
    });

    test('getPathSet', async () => {
        const tree = await fileHelper.getPathSet(minimal);
        expect(tree).to.eql(new Set([
            "A/E.txt", "A/F.txt", "A/G.md",
            "C.txt", "D.md",
            "Supercalifragilisticexpialidocious.py",
            "deoxyribonucleicAcid/I",
        ]));
    });
});
