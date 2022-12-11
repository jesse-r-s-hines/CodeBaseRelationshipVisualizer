import * as vscode from 'vscode';
import { Uri, workspace, FileType } from 'vscode';
import * as path from 'path';
import * as child_process from 'child_process';
import * as child_process_promise from 'child-process-promise';
import _ from 'lodash';

import { API, Visualization, VisualizationSettings, Connection } from "../api";

export async function activate(context: vscode.ExtensionContext) {
    const cbrvAPI = new API(context);

    installPyDepsIfNeeded();

    context.subscriptions.push(
        vscode.commands.registerCommand('pythonDependencyVisualization.start', async () => {
            const visualization = await createPythonDependencyVisualization(cbrvAPI);
        }),
    );
}

function installPyDepsIfNeeded() {
    const pythonPath = vscode.workspace.getConfiguration('python').get<string>('defaultInterpreterPath', 'python');

    child_process.exec(`'${pythonPath}' -m pydeps --version`, (error) => {
        if (error) {
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Installing pydeps...",
                cancellable: true
            }, (progress, token) => {
                return new Promise((resolve, reject) => {
                    const proc = child_process.exec(`'${pythonPath}' -m pip install pydeps`, (error) => {
                        if (error) {
                            const message = `Failed to install pydeps:\n ${error.message}`;
                            vscode.window.showErrorMessage(message);
                            reject(new Error(message));
                        } else {
                            vscode.window.showInformationMessage(`Installed pydeps`);
                            resolve(undefined);
                        }
                    });

                    token.onCancellationRequested(() => {
                        proc.kill();
                    });
                });
            });
        }
    });
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

    visualization.onFSChange(async (visState) => {
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

    const allFiles = new Set(files.map(uri => uri.fsPath));
    const dependencyGraph: Map<string, string[]> = new Map();
    const stack = [...files];

    while (stack.length > 0) {
        const uri = stack.pop()!;
        // Only get deps for non-symlink python files that have not already been done
        if (path.extname(uri.fsPath) == ".py" && !dependencyGraph.has(uri.fsPath) && !(await isSymlink(uri))) {
            let graph: any;
            try {
                // Get dep JSON, with infinite bacon "depth"
                const result = await child_process_promise.spawn(pythonPath,
                    ['-m', 'pydeps', '--show-deps', '--no-output', '--max-bacon', '0', uri.fsPath],
                    { capture: ['stdout', 'stderr'], cwd: codebase.fsPath }
                );
                graph = JSON.parse(result.stdout);
            } catch (e) {
                console.log('Error', e);
                graph = undefined;
            }

            if (graph) {
                for (const [moduleName, info] of Object.entries<any>(graph)) {
                    if (typeof info.path == 'string') {
                        if (allFiles.has(info.path) && !dependencyGraph.has(info.path)) {
                            const dependencies = (info.imports ?? [])
                                .flatMap((m: string) => {
                                    const modulePath = graph[m].path;
                                    if (typeof modulePath == 'string' && allFiles.has(modulePath)) {
                                        return [modulePath];
                                    } else {
                                        return [];
                                    }
                                });
                            dependencyGraph.set(info.path, dependencies);
                        }
                    }
                }
            }
        }
    }

    return [...dependencyGraph.entries()]
        .flatMap(([source, dependencies]) =>
            dependencies.map(dep => ({
                from: Uri.file(source),
                to: Uri.file(dep),
            }))
        );
}
