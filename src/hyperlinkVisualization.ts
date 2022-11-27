import * as vscode from 'vscode';
import { workspace, Uri, RelativePattern } from 'vscode';
import { promises as fs } from 'fs';
import * as path from 'path';
import { TextDecoder } from 'text-encoding';
import { API, VisualizationSettings, Connection } from "./api";
import _ from 'lodash';


export async function visualizeHyperlinkGraph(cbrvAPI: API) {
    const settings: VisualizationSettings = {
        title: "Hyperlink Visualization",
        directed: true,
        showOnHover: true,
        connectionDefaults: {
            tooltip: (conn) => _(conn.connections)
                .map(c => `"${c.from?.file}" -> "${c.to?.file}"`)
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

    const codebase = workspace.workspaceFolders![0]!.uri;
    const files = await workspace.findFiles(new RelativePattern(workspace.workspaceFolders![0]!.uri, '**/*'));
    const connections = await getHyperlinks(codebase, files, "");
    const visualization = await cbrvAPI.create(settings, connections);
    return visualization;
}

async function getHyperlinks(codebase: Uri, files: Uri[], base: string): Promise<Connection[]> {
    const pathSet = new Set(files.map(uri => path.relative(codebase.fsPath, uri.fsPath)));
    const connections: Connection[] = [];

    for (const file of files) {
        const relativePath = path.relative(codebase.fsPath, file.fsPath);

        if (relativePath.endsWith(".md")) {
            const contents = (await fs.readFile(file.fsPath)).toString();
            const regex = /\[.*?\]\((.*?)\)|<(.*?)>|(https?:\/\/\S*)/g;
            for (const [whole, ...groups] of contents.matchAll(regex)) {
                // matchAll returns undefined for the unmatched "|" sections
                let link = groups.filter(u => u !== undefined)[0];
                link = normalizeLink(link, base);
                const to = pathSet.has(link) ? link : undefined;
                connections.push({ from: relativePath, to: to });
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