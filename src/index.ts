import * as vscode from 'vscode';
import { workspace, Uri, Webview, FileType } from 'vscode';
import * as path from 'path';
import { AnyFile, Connection } from "./shared";
import { Visualization } from "./Visualization";
import { TextDecoder } from 'text-encoding';
import fs = vscode.workspace.fs
import { getPathSet } from './fileHelper';

export function activate(context: vscode.ExtensionContext) {
    console.log("CodeBase Relationship Visualizer active");

    context.subscriptions.push(
        vscode.commands.registerCommand('codeBaseRelationshipVisualizer.start', async () => {
            const codebase = vscode.workspace.workspaceFolders![0]!.uri;
            const links = await getHyperlinks(codebase, "");
            // const links = [] as Connection[];
            const visualization = new Visualization(context, {
                title: "Hyperlink Visualization",
                directed: true,
                showOnHover: false,
                connectionDefaults: {
                    color: 'green',
                    tooltip: (conn) => conn.color,
                },
                mergeRules: true,
            }, links);
            await visualization.launch();
        }),
    );

    // TODO: Remove this. Launching automatically for convenience during testing. Also remove "*" activationEvent.
    vscode.commands.executeCommand('codeBaseRelationshipVisualizer.start');
}

async function getHyperlinks(codebase: Uri, linkBase: string): Promise<Connection[]> {
    const pathSet = await getPathSet(codebase);
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