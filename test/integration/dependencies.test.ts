import { expect } from 'chai';
import { describe, test, it } from "mocha";
import { workspace, Uri, RelativePattern } from 'vscode';
import * as path from 'path';
import dedent from "dedent-js";

import { getDependencyGraph } from '../../src/visualizations/pythonDependencyVisualization';
import { writeFileTree } from "./integrationHelpers";

async function testGetDependencyGraph(dir: Uri, files?: string[]) {
    let fileUris: Uri[];
    if (files) {
        fileUris = files.map(f => Uri.file(path.resolve(dir.fsPath, f)));
    } else {
        fileUris = await workspace.findFiles(new RelativePattern(dir, '**/*'));
    }
    return (await getDependencyGraph(dir, fileUris)).map(c => ({
        from: path.relative(dir.fsPath, (c.from as any).fsPath),
        to: path.relative(dir.fsPath, (c.to as any).fsPath),
    }));
}

describe("Test getDependencyGraph", () => {
    it('test basic', async () => {
        const dir = await writeFileTree({
            'mypkg/__init__.py': "",
            'mypkg/a.py': dedent`
                from pathlib import Path
                import threading
                import b.c
            `,
            'mypkg/b/__init__.py': "",
            'mypkg/b/c.py': dedent`
                from . import d
            `,
            'mypkg/b/d.py': dedent`
                from . import c
            `,
        });
        expect(await testGetDependencyGraph(Uri.joinPath(dir, 'mypkg'))).to.eql([
            { from: "b/c.py", to: "__init__.py" },
            { from: "b/c.py", to: "b/__init__.py" },
            { from: "b/c.py", to: "b/d.py" },
            { from: "b/d.py", to: "__init__.py" },
            { from: "b/d.py", to: "b/__init__.py" },
            { from: "b/d.py", to: "b/c.py" },
            { from: "a.py", to: "b/__init__.py" },
            { from: "a.py", to: "b/c.py" },
        ]);
    });

    it('test empty', async () => {
        const dir = await writeFileTree({
        });
        expect(await testGetDependencyGraph(dir)).to.eql([
        ]);
    });

    it('test single', async () => {
        const dir = await writeFileTree({
            'mypkg/a.py': dedent`
                print('hello world')
            `,
        });
        expect(await testGetDependencyGraph(Uri.joinPath(dir, 'mypkg'))).to.eql([
        ]);
    });

    it('test missing', async () => {
        const dir = await writeFileTree({
            'mypkg/__init__.py': "",
            'mypkg/a.py': dedent`
                from pathlib import Path
                import threading
                import b.c
                import b.d
            `,
            'mypkg/b/__init__.py': "",
            'mypkg/b/c.py': dedent`
                print('c')
            `,
        });
        expect(await testGetDependencyGraph(Uri.joinPath(dir, 'mypkg'))).to.eql([
            {from: "a.py", to: "b/__init__.py"},
            {from: "a.py", to: "b/c.py"},
        ]);
    });

    it('test excluded', async () => {
        const dir = await writeFileTree({
            'mypkg/__init__.py': "",
            'mypkg/a.py': dedent`
                import b
            `,
            'mypkg/b.py': dedent`
                import c
            `,
            'mypkg/c.py': dedent`
                import d
            `,
            'mypkg/d.py': dedent`
                print('hello world')
            `,
        });
        const actual = await testGetDependencyGraph(Uri.joinPath(dir, 'mypkg'), [
            '__init__.py',
            'a.py',
            'c.py',
            'd.py',
        ]);

        expect(actual).to.eql([
            { from: "c.py", to: "d.py" },
        ]);
    });
});



