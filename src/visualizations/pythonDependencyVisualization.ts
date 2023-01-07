import * as vscode from 'vscode';
import { Uri, workspace, FileType } from 'vscode';
import * as path from 'path';
import * as child_process_promise from 'child-process-promise';
import { promises as fsp } from 'fs';
import _ from 'lodash';

import { API, Visualization, VisualizationSettings, Connection } from "../api";
import { dependencies } from 'webpack';

export async function activate(context: vscode.ExtensionContext) {
    const cbrvAPI = new API(context);

    context.subscriptions.push(
        vscode.commands.registerCommand('pythonDependencyVisualization.start', async () => {
            await installPyDepsIfNeeded();
            const visualization = await createPythonDependencyVisualization(cbrvAPI);
        }),
    );
}

export async function installPyDepsIfNeeded() {
    const pythonPath = vscode.workspace.getConfiguration('python').get<string>('defaultInterpreterPath', 'python');

    let installed = false;
    try {
        await child_process_promise.spawn(pythonPath, ['-m', 'pydeps', '--version']);
        installed = true;
    } catch {
        installed = false;
    }

    if (!installed) {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Installing pydeps...",
            cancellable: false
        }, async (progress, token) => {
            try {
                await child_process_promise.spawn(pythonPath, ['-m', 'pip', 'install', 'pydeps'],
                    { capture: ['stdout', 'stderr'] });
                vscode.window.showInformationMessage(`Installed pydeps`);
            } catch (e: any) {
                const message = `Failed to install pydeps:\n ${e.stderr}`;
                vscode.window.showErrorMessage(message);
                throw new Error(message);
            }
        });
    }
}

async function createPythonDependencyVisualization(cbrvAPI: API): Promise<Visualization> {
    const settings: VisualizationSettings = {
        title: "Python Dependency Visualization",
        directed: true,
        showOnHover: true,
        connectionDefaults: {
            tooltip: (conn, vis) => _(conn.connections)
                .map(c => `"${vis.getRelativePath(c.from)}" -> "${vis.getRelativePath(c.to)}"`)
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
        filters: {
            include: "**/*.py",
        }
    };

    const visualization = await cbrvAPI.create(settings);

    visualization.onFilesChange(async (visState) => {
        visState.connections = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Loading dependency graph...",
            cancellable: false,
        }, async (progress, token) => {
            return await getDependencyGraph(visState.codebase, visState.files);
        });
    }, { immediate: true });

    return visualization;
}

async function isSymlink(file: Uri) {
    const stat = await workspace.fs.stat(file);
    return (stat.type & FileType.SymbolicLink) === FileType.SymbolicLink;
}

export async function getDependencyGraph(codebase: Uri, files: Uri[]): Promise<Connection[]> {
    const pythonPath = vscode.workspace.getConfiguration('python').get<string>('defaultInterpreterPath', 'python');
    const codebasePath = await fsp.realpath(codebase.fsPath);

    // normalize and resolve symlinks in path
    const fsPaths = await Promise.all(files.map(f => fsp.realpath(f.fsPath)));
    const fsPathsSet = new Set(fsPaths);

    // NOTE: We can use `--max-bacon 0` to recurse the tree in one process call and make it a lot faster. See 74c02cd
    // for an implementation of this. But pydeps treats module imports slightly differently depending on how the module
    // was reached, causing inconsistent results based on file order. E.g if `b.c` is the root file, or if its reached
    // via a relative import `from .b import c`, it will depend on the root package `__init__.py`. But if we reach it
    // via `import b.c` it won't depend on the root `__init__.py`. Just naively calling pydeps on each file fixes this.

    const promises = _(fsPaths)
        .map<Promise<[string, string[]]>>(async (fsPath) => {
            const ext = path.extname(fsPath).toLocaleLowerCase();

            if (ext == ".py" && !(await isSymlink(Uri.file(fsPath)))) {
                const result = await child_process_promise.spawn(pythonPath,
                    ['-m', 'pydeps', '--show-deps', '--no-output', '--max-bacon', '2', fsPath],
                    { capture: ['stdout', 'stderr'], cwd: codebasePath }
                );
                const graph = JSON.parse(result.stdout);

                // Resolve all links in graph (I could probably skip this, pydeps seems to do it already)
                const realPaths = await Promise.all(_(graph)
                    .map<Promise<[string, any]>>(async (info, moduleName: string) =>
                        [moduleName, typeof info.path == 'string' ? await fsp.realpath(info.path) : info.path] 
                    ).value()
                );
                for (const [moduleName, realPath] of realPaths) {
                    graph[moduleName].path = realPath;
                }

                const modules: string[] = _(graph).find(info => info.path == fsPath)?.imports ?? [];
                const imports = modules
                    .map(m => graph[m].path)
                    .filter(p => typeof p == 'string' && fsPathsSet.has(p));
                return [fsPath, imports];
            } else {
                return [fsPath, []];
            }

        })
        .value();
        
    return (await Promise.all(promises))
        .flatMap(([source, dependencies]) =>
            dependencies.map(dep => ({
                from: Uri.file(source),
                to: Uri.file(dep),
            })) 
        );
}
