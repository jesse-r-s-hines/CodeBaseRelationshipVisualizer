import * as vscode from 'vscode';
import { Uri } from 'vscode';
import { API, Visualization, VisualizationSettings, Connection } from "./api";
import {DebugAdapterTracker, DebugSession} from 'vscode';
import {DebugProtocol} from 'vscode-debugprotocol';
import * as path from "path";


export async function activate(context: vscode.ExtensionContext) {
    const cbrvAPI = new API(context);
    const stackTraceVisualization = new StackTraceVisualization(); // set globally so we can access it

    context.subscriptions.push(
        vscode.debug.registerDebugAdapterTrackerFactory("*", stackTraceVisualization),
        vscode.commands.registerCommand('stackTraceVisualization.start', async () => {
            stackTraceVisualization.visualization = await createStackTraceVisualization(cbrvAPI);
            stackTraceVisualization.updateVisualization();
        }),
    );
}

async function createStackTraceVisualization(cbrvAPI: API): Promise<Visualization> {
    const settings: VisualizationSettings = {
        title: "Stack Trace Visualization",
        directed: true,
        connectionDefaults: {
            // tooltip: (conn) => _(conn.connections)
            //     .map(c => `"${c.from?.file}" -> "${c.to?.file}"`)
            //     .countBy()
            //     .map((count, tooltip) => count == 1 ? tooltip : `${tooltip} x${count}`)
            //     .sortBy()
            //     .join("<br/>")
        },
        mergeRules: {
            // file: "ignore",
            // line: "ignore",
            // direction: "ignore",
            // width: "greatest",
            // color: "mostCommon",
        },
    };

    return await cbrvAPI.create(settings);
}

class StackTraceVisualization implements vscode.DebugAdapterTrackerFactory {
    visualization?: Visualization;
    stackTrace?: {file: string, line?: number}[];

    createDebugAdapterTracker(session: DebugSession): DebugAdapterTracker {
        return {
            onDidSendMessage: async (msg: DebugProtocol.ProtocolMessage) => {
                if (msg.type == "event" && (msg as DebugProtocol.Event).event == "stopped") {
                    const stoppedMsg = msg as DebugProtocol.StoppedEvent;
                    const threadId = stoppedMsg.body.threadId;

                    // TODO VSCode docs imply I need to do "paging" of the stackTrace? I can't get python debugging
                    // to require paging, may be implementation dependent.
                    const stackTrace = await session.customRequest("stackTrace", {
                        threadId: threadId,
                    }) as DebugProtocol.StackTraceResponse['body'];

                    this.stackTrace = [...stackTrace.stackFrames]
                        .reverse()
                        .map((frame) => ({
                            file: frame.source!.path!,
                            line: frame.line,
                        }));

                    this.updateVisualization();
                }
            },
            onWillStopSession: async () => {
                this.stackTrace = undefined;
                this.updateVisualization();
            }
        };
    }

    updateVisualization() {
        this.visualization?.update(async visState => {
            visState.connections = (this.stackTrace ?? []).map((frame, i, arr) => ({
                from: (i == 0) ? undefined : {
                    file: path.relative(visState.codebase.fsPath, arr[i - 1].file),
                    line: arr[i - 1].line,
                },
                to: {
                    file: path.relative(visState.codebase.fsPath, frame.file),
                    line: frame.line,
                },
            }));
            console.log("updateVisualization", visState.connections);
        });
    }
}
