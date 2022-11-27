import * as vscode from 'vscode';
import { workspace, Uri, RelativePattern } from 'vscode';
import fs = vscode.workspace.fs
import * as path from 'path';
import { TextDecoder } from 'text-encoding';
import { API, VisualizationSettings, Connection } from "./api";


export async function visualizeHyperlinkGraph(cbrvAPI: API) {
    const settings: VisualizationSettings = {
        title: "Hyperlink Visualization",
        directed: true,
        showOnHover: true,
        connectionDefaults: {
            tooltip: (conn) => `${conn.from?.file} -> ${conn.to?.file}`,
        },
        mergeRules: true,
    };

    const connections = await getHyperlinks(workspace.workspaceFolders![0]!.uri, "");
    console.log("hyperlinkGraphVisualization", workspace.workspaceFolders![0]!.uri, connections);
    const visualization = await cbrvAPI.create(settings, connections);
    return visualization;
}

async function getHyperlinks(codebase: Uri, linkBase: string): Promise<Connection[]> {
    // get a flat list of all files
    const uris = (await workspace.findFiles(new RelativePattern(codebase, '**/*')));
    const pathSet = new Set(uris.map(uri => path.relative(codebase.fsPath, uri.fsPath)));
    const connections: Connection[] = [];

    for (const path of pathSet) {
        if (path.endsWith(".md")) {
            // TODO surely there's a built in way to do this..., also need to add checks
            const contents = new TextDecoder().decode(await fs.readFile(Uri.joinPath(codebase, path)));
            const regex = /\[.*?\]\((.*?)\)|<(.*?)>|(https?:\/\/\S*)/g;
            for (const [whole, ...groups] of contents.matchAll(regex)) {
                let link = groups.filter(u => u !== undefined)[0]; // matchAll returns undefined for the unmatched "|" sections
                link = normalizeLink(link, linkBase);
                const to = pathSet.has(link) ? link : undefined;
                connections.push({ from: path, to: to, color: ['red', 'blue'][Math.floor(Math.random() * 3)] });
            }
        }
    }

    return connections;
}

function normalizeLink(link: string, base: string): string {
    if (!link.endsWith(".md")) {
        link = `${link}.md`;
    }
    if (link.startsWith(base)) {
        link = link.slice(base.length);
    }
    link = link.split('#')[0];
    link = link.replace(/^(\/)+/g, '');
    return link;
}