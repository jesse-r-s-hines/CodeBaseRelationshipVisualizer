import { expect } from 'chai';
import { describe, test } from "mocha"
import * as vscode from 'vscode';
import { Uri } from 'vscode'

import { FileType } from '../../src/shared'
import * as fileHelper from '../../src/fileHelper'

// I can't find a built-in way to get workspaceFolder. __dirname is .../CBRV/dist/test/test/integration
const workspaceFolder = Uri.file(__dirname.split("/").slice(0, -4).join("/"))
const samples = Uri.joinPath(workspaceFolder, `/test/sample-codebases`);
const minimal = {
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
    test('getWorkspaceFileTree', async () => {
        // Opening files doesn't work reliably, so we are just opening sample-codebases in the launch script.
        // await vscode.commands.executeCommand("vscode.openFolder", Uri.joinPath(samples, "minimal"));

        const tree = await fileHelper.getWorkspaceFileTree();
        expect(tree?.name).to.eql("sample-codebases")
        // we'll test the content in getFileTree directly
    });

    test('getFileTree', async () => {
        const tree = await fileHelper.getFileTree(Uri.joinPath(samples, "minimal"));
        expect(tree).to.eql(minimal);
    });

    test('listToFileTree', async () => {
        const includePattern = new vscode.RelativePattern(Uri.joinPath(samples, "minimal"), '**/*')
        const fileList = await vscode.workspace.findFiles(includePattern)
        const tree = await fileHelper.listToFileTree(Uri.joinPath(samples, "minimal"), fileList)
        expect(tree).to.eql(minimal);
    });

    test('getPathSet', async () => {
        const tree = await fileHelper.getPathSet(Uri.joinPath(samples, "minimal"));
        expect(tree).to.eql(new Set([
            "A/E.txt", "A/F.txt", "A/G.md",
            "C.txt", "D.md",
            "Supercalifragilisticexpialidocious.py",
            "deoxyribonucleicAcid/I",
        ]));
    });
});
