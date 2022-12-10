import * as vscode from 'vscode';
import { Uri } from 'vscode';
import { promises as fs } from 'fs';
import * as path from 'path';
import { API, Visualization, VisualizationSettings, Connection } from "./api";
import _ from 'lodash';

export async function activate(context: vscode.ExtensionContext) {
    const cbrvAPI = new API(context);
    context.subscriptions.push(
        vscode.commands.registerCommand('hyperlinkVisualization.start', async () => {
            const visualization = await createHyperlinkVisualization(cbrvAPI);
        }),
    );
}

async function createHyperlinkVisualization(cbrvAPI: API): Promise<Visualization> {
    const settings: VisualizationSettings = {
        title: "Hyperlink Visualization",
        directed: true,
        showOnHover: true,
        connectionDefaults: {
            tooltip: (conn, vis) => _(conn.connections)
                .map(c => `"${vis.getRelativePath(c.from)}" -> "${vis.getRelativePath(c.to)}"`)
                .countBy()
                .map((count, tooltip) => count == 1 ? tooltip : `${tooltip} x${count}`)
                .sortBy()
                .join("<br/>")
        },
        mergeRules: {
            file: "ignore",
            line: "ignore",
            direction: "ignore",
            width: "greatest",
            color: "mostCommon",
        },
    };

    const visualization = await cbrvAPI.create(settings);

    visualization.onFSChange(async (visState) => {
        visState.connections = await getHyperlinks(visState.codebase, visState.files);
    }, {immediate: true});

    return visualization;
}

// Using regex to pull out the links. This is rather brittle, but avoids the overhead of a full html and markdown parser
const htmlLinkRegex = /\b(?:href|src)\s*=\s*["'](.+?)["']|(https?:\/\/[^\s>"']*[^\s>"'.!?])/g;
const markdownLinkRegex = new RegExp(`${htmlLinkRegex.source}|${/\[.*?\]\((.+?)\)|<(\S+?)>/.source}`, 'g');

export async function getHyperlinks(codebase: Uri, files: Uri[]): Promise<Connection[]> {
    // Convert paths relative to codebase, and sort so we can binary search for files with the same name but different
    // ext. Among files with the same basename, make sure the files without an ext appear before first.
    const paths = _(files)
        .map(uri => path.relative(codebase.fsPath, uri.fsPath))
        .sortBy(stripExt, path.extname)
        .value();
    
    // Converts a relative path to a Uri
    const toUri = (file: string) => Uri.file(path.resolve(codebase.fsPath, file));

    // Checks if there's a matching path, ignoring extensions. Returns the matching path (with extension) or undefined.
    const findByName = (p: string): string|undefined => {
        const basename = stripExt(p);

        const matches = [];
        let i = _.sortedIndexBy(paths, basename, stripExt);
        while (i < paths.length && stripExt(paths[i]) == basename) {
            matches.push(paths[i]);
            i++;
        }

        if (matches.length > 0) {
            return matches.find(m => m === p) ?? matches[0]; // return exact match if there is one, else first
        } else {
            return undefined;
        }
    };

    /** Best effort to match the link with an actual file */
    const resolveLink = (file: Uri, link: string): Uri|undefined => {
        link = link
            .split('#')[0] // remove any # url part
            .trim()
            .replace(/^https?:\/\//, '') // remove http://
            .replace("\\", "/") // convert to URL/posix style if we have windows paths for some reason
            .replace(/(^\/+)|(\/+$)/, '') // trim trailing "/"
            .trim();

        if (link == "") return undefined;

        // try interpreting as a path relative to this file, e.g. ../image.png
        const relativePath = path.relative(codebase.fsPath, path.resolve(path.dirname(file.fsPath), link));
        let match = findByName(relativePath);
        if (match) return toUri(match);
        
        // check if its an absolute path from some common "base"
        const guesses = link // try trimming off parts from the beginning until we get a working path
            .split("/")
            .map((s, i, arr) => arr.slice(i, undefined).join("/"));

        for (const guess of guesses) {
            match = findByName(guess);
            if (match) return toUri(match);
        }

        return undefined;
    };

    const fileConns: Connection[][] = await Promise.all(files.map(async (file) => {
        const ext = path.extname(file.fsPath).toLowerCase();

        if ([".md", ".html"].includes(ext)) {
            const regex = ext == '.html' ? htmlLinkRegex : markdownLinkRegex;
            const contents = (await fs.readFile(file.fsPath)).toString();
            const matches = [...contents.matchAll(regex)];
            return matches
                .map(([whole, ...groups]) => {
                    // matchAll returns undefined for the unmatched "|" sections
                    const link = groups.filter(u => u !== undefined)[0];
                    return resolveLink(file, link);
                })
                .filter(f => f) // remove undefined links
                .map(to => ({ from: file, to: to }));
        } else {
            return [];
        }
    }));

    return fileConns.flat();
}

function stripExt(p: string) {
    const parsed = path.parse(p);
    return path.join(parsed.dir, parsed.name);
}
