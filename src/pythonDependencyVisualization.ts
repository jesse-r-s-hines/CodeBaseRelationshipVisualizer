import * as vscode from 'vscode';
import { Uri } from 'vscode';
import * as path from 'path';
import { API, Visualization, VisualizationSettings, Connection } from "./api";
import * as child_process from 'child_process';
import * as child_process_promise from 'child-process-promise';
import _ from 'lodash';

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
    const pythonPath = vscode.workspace.getConfiguration('python').get('defaultInterpreterPath') as string;

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
            tooltip: (conn) => _(conn.connections)
                .map(c => `"${c.from?.file}" -> "${c.to?.file}"`)
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

export async function getDependencyGraph(codebase: Uri, files: Uri[]): Promise<Connection[]> {
    const pythonPath = vscode.workspace.getConfiguration('python').get('defaultInterpreterPath') as string;

    const allFiles = new Set(files.map(uri => uri.fsPath));
    const dependencyGraph: Map<string, string[]> = new Map();
    const stack = files.map(uri => uri.fsPath);

    while (stack.length > 0) {
        const fsPath = stack.pop()!;
        const relPath = path.relative(codebase.fsPath, fsPath);
        if (path.extname(fsPath) == ".py" && !dependencyGraph.has(relPath)) { // python and not already filled in
            let graph: any;
            try {
                const result = await child_process_promise.spawn(pythonPath,
                    ['-m', 'pydeps', '--show-deps', '--no-output', '--max-bacon', '0', fsPath], // infinite bacon
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
                        const infoPathRel = path.relative(codebase.fsPath, info.path);
                        if (allFiles.has(info.path) && !dependencyGraph.has(infoPathRel)) {
                            const dependencies = (info.imports ?? [])
                                .flatMap((m: string) => {
                                    const modulePath = graph[m].path;
                                    if (typeof modulePath == 'string' && allFiles.has(modulePath)) {
                                        return [path.relative(codebase.fsPath, modulePath)];
                                    } else {
                                        return [];
                                    }
                                });
                            dependencyGraph.set(infoPathRel, dependencies);
                        }
                    }
                }
            }
        }
    }

    return [...dependencyGraph.entries()]
        .flatMap(([source, dependencies]) =>
            dependencies.map(dep => ({ from: source, to: dep }))
        );
}
