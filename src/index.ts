import * as vscode from 'vscode';
import { workspace, Uri, RelativePattern } from 'vscode';
import * as path from 'path';
import { AnyFile, Connection, VisualizationSettings } from "./shared";
import { API } from "./api";
import { TextDecoder } from 'text-encoding';
import fs = vscode.workspace.fs

export function activate(context: vscode.ExtensionContext) {
    console.log("CodeBase Relationship Visualizer active");
    const cbrvAPI = new API(context);

    context.subscriptions.push(
        vscode.commands.registerCommand('codeBaseRelationshipVisualizer.start', async () => {
            const settings: VisualizationSettings = {
                title: "Hyperlink Visualization",
                directed: true,
                showOnHover: false,
                connectionDefaults: {
                    color: 'green',
                    tooltip: (conn) => conn.color,
                },
                mergeRules: true,
            };
            const connections = await getHyperlinks(vscode.workspace.workspaceFolders![0]!.uri, "");
            const visualization = cbrvAPI.create(settings, connections);
            await visualization.launch();
        }),
    );

    // TODO: Remove this. Launching automatically for convenience during testing. Also remove "*" activationEvent.
    vscode.commands.executeCommand('codeBaseRelationshipVisualizer.start');
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