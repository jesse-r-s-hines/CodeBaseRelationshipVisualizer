import { expect } from 'chai';
import { describe, test, it } from "mocha";
import { getDependencyGraph } from '../../src/visualizations/pythonDependencyVisualization';
import { writeFileTree } from "./integrationHelpers";
import { workspace, Uri, RelativePattern } from 'vscode';
import * as path from 'path';
import dedent from "dedent-js";

async function testGetDependencyGraph(dir: Uri) {
    const files = await workspace.findFiles(new RelativePattern(dir, '**/*'));
    const x = (await getDependencyGraph(dir, files));
    return (await getDependencyGraph(dir, files)).map(c => ({
        from: path.relative(dir.fsPath, (c.from as any).fsPath),
        to: path.relative(dir.fsPath, (c.to as any).fsPath),
    }));
}

describe("Test getDependencyGraph", () => {
    // it('test basic', async () => {
    //     let dir = await writeFileTree({
    //         'mypkg/__init__.py': "",
    //         'mypkg/a.py': dedent`
    //             from pathlib import Path
    //             import threading
    //             import b.c
    //         `,
    //         'mypkg/b/__init__.py': "",
    //         'mypkg/b/c.py': dedent`
    //             from . import d
    //         `,
    //         'mypkg/b/d.py': dedent`
    //             from . import c
    //         `,
    //     });
    //     expect(await testGetDependencyGraph(Uri.joinPath(dir, 'mypkg'))).to.eql([
    //         { from: "b/c.py", to: "__init__.py" },
    //         { from: "b/c.py", to: "b/__init__.py" },
    //         { from: "b/c.py", to: "b/d.py" },
    //         { from: "b/d.py", to: "__init__.py" },
    //         { from: "b/d.py", to: "b/__init__.py" },
    //         { from: "b/d.py", to: "b/c.py" },
    //         { from: "a.py", to: "b/__init__.py" },
    //         { from: "a.py", to: "b/c.py" },
    //     ]);
    // });

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
});



