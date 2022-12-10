import { expect } from 'chai';
import { describe, test, it } from "mocha";
import { getHyperlinks } from '../../src/visualizations/hyperlinkVisualization';
import { writeFileTree } from "./integrationHelpers";
import { workspace, Uri, RelativePattern } from 'vscode';
import * as path from 'path'

async function testGetHyperlinks(dir: Uri) {
    const files = await workspace.findFiles(new RelativePattern(dir, '**/*'));
    return (await getHyperlinks(dir, files)).map(c => ({
        from: path.relative(dir.fsPath, (c.from as any).fsPath),
        to: path.relative(dir.fsPath, (c.to as any).fsPath),
    }));
}

describe("Test getHyperlinks", () => {
    it('test markdown', async () => {
        let dir = await writeFileTree({
            'A.md': "A link to [this](./B.md)",
            'B.md': "Lorem ipsum...",
        });
        expect(await testGetHyperlinks(dir)).to.eql([
            {from: "A.md", to: "B.md"},
        ]);

        dir = await writeFileTree({
            'A.md': "A link to [itself](./A.md)",
        });
        expect(await testGetHyperlinks(dir)).to.eql([
            {from: "A.md", to: "A.md"},
        ]);

        dir = await writeFileTree({
            'stuff/A.md': "A link to [this](./B.md) and [this](../C.md)",
            'stuff/B.md': "Lorem ipsum...",
            'C.md': "Lorem ipsum...",
        });
        expect(await testGetHyperlinks(dir)).to.eql([
            {from: "stuff/A.md", to: "stuff/B.md"},
            {from: "stuff/A.md", to: "C.md"},
        ]);

        dir = await writeFileTree({
            'stuff/A.md': `Links that start from different bases
                [1](https://myserver.com/path/to/stuff/B.md)
                [2](https://myserver.com/path/to/C.md)
                [3](/some/path/to/stuff/B.md)
                [4](/some/path/to/stuff/C.md) Will still be found, as C.md (false positive from being flexible)
                [5](/D.md)
                [6](D.md)
            `,
            'stuff/B.md': "Lorem ipsum...",
            'C.md': "Lorem ipsum...",
            'D.md': "Lorem ipsum...",
        });
        expect(await testGetHyperlinks(dir)).to.eql([
            {from: "stuff/A.md", to: "stuff/B.md"},
            {from: "stuff/A.md", to: "C.md"},
            {from: "stuff/A.md", to: "stuff/B.md"},
            {from: "stuff/A.md", to: "C.md"},
            {from: "stuff/A.md", to: "D.md"},
            {from: "stuff/A.md", to: "D.md"},
        ]);

        dir = await writeFileTree({
            'stuff/A.md': `
                Different types of links:
                    https://myserver.com/stuff/B.md
                    <./stuff/C.md>
                    <https://myserver.com/stuff/D.md>
            `,
            'stuff/B.md': "Lorem ipsum...",
            'stuff/C.md': "Lorem ipsum...",
            'stuff/D.md': "Lorem ipsum...",
        });
        expect(await testGetHyperlinks(dir)).to.eql([
            {from: "stuff/A.md", to: "stuff/B.md"},
            {from: "stuff/A.md", to: "stuff/C.md"},
            {from: "stuff/A.md", to: "stuff/D.md"},
        ]);

        dir = await writeFileTree({
            'A.md': `A <a href="B.md">html style link</a> will work in markdown.`,
            'B.md': `Lorem Ipsum`,
        });
        expect(await testGetHyperlinks(dir)).to.eql([
            {from: "A.md", to: "B.md"},
        ]);
    });

    it('test missing links', async () => {
        const dir = await writeFileTree({
            'A.md': "A markdown file with a [broken link](./not-a-file.md)",
            'B.md': "Lorem ipsum...",
        });
        expect(await testGetHyperlinks(dir)).to.eql([
        ]);
    });

    it('test html', async () => {
        const dir = await writeFileTree({
            'index.html': `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <title>P.html</title>
                    <link rel="stylesheet" href="assets/styles.css">
                </head>
                <body>
                    <p>
                        A <a href="/path/to/blog.html">link</a> and
                        another to a <a href="/path/to/markdown/file.md">markdown file</a>
                        one with a <a href = 'https://myserver.com/some/more/path/to/blog.html'>full path</a>
                    </p>
                    <p>
                        This markdown style [link](page.html) should not be a detected, but this raw link will be
                        http://myserver.com/page.html.
                    </p>
                    <p> https://example.com won't be found </p>
                    <img src="img.jpg">
                    <script src="assets/script.js"></script>
                </body>
                </html>
            `,
            'path/to/blog.html': `...`,
            'path/to/markdown/file.md': `...`,
            'page.html': '...',
            'img.jpg': '...',
            'assets/script.js': "console.log('hello world')",
            'assets/styles.css': "body { background-color: green; }",
        });
        expect(await testGetHyperlinks(dir)).to.eql([
            {from: "index.html", to: "assets/styles.css"},
            {from: "index.html", to: "path/to/blog.html"},
            {from: "index.html", to: "path/to/markdown/file.md"},
            {from: "index.html", to: "path/to/blog.html"},
            {from: "index.html", to: "page.html"},
            {from: "index.html", to: "img.jpg"},
            {from: "index.html", to: "assets/script.js"},
        ]);
    });
});



