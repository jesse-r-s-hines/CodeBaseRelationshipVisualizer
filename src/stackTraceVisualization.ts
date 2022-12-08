import * as vscode from 'vscode';
import { Uri } from 'vscode';
import { API, Visualization, VisualizationSettings, Connection } from "./api";
import { DebugAdapterTracker, DebugSession } from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import * as path from "path";
import _ from "lodash";

const colorScheme = [
    "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"
];

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
            tooltip: (conn) => {
                const tooltips = conn.connections
                    .map(c => `to Thread ${c.threadId} "${c.toName}" "${c.to!.file}:${c.to!.line}"`);
                return _(tooltips)
                    .countBy()
                    .toPairs()
                    .sortBy(pair => tooltips.indexOf(pair[0])) // put back in original order
                    .map(([tooltip, count]) => (count > 1) ? `${tooltip} (x${count})` : tooltip)
                    .join("<br/>");
            }
        },
        mergeRules: {
            file: "ignore",
            line: "ignore",
            direction: "same",
            width: { rule: "add", max: 4 },
            threadId: "same",
        },
    };

    return await cbrvAPI.create(settings);
}


type Frame = { file: string, line: number, name: string }

class StackTraceVisualization implements vscode.DebugAdapterTrackerFactory {
    visualization?: Visualization;
    stackTraces: Map<number, Frame[]> = new Map();

    createDebugAdapterTracker(session: DebugSession): DebugAdapterTracker {
        return {
            onDidSendMessage: async (msg: DebugProtocol.ProtocolMessage) => {
                if (msg.type == "event" && (msg as DebugProtocol.Event).event == "stopped") {
                    const stoppedMsg = msg as DebugProtocol.StoppedEvent;
                    const threadId = stoppedMsg.body.threadId!;

                    this.stackTraces.set(threadId, []); // doesn't matter if we overwrite it, we're re-fetching anyways

                    const pairs = await Promise.all(
                        [...this.stackTraces.keys()]
                            .map<Promise<[number, DebugProtocol.StackTraceResponse['body']]>>(async threadId => {
                                const stackTrace = await session.customRequest("stackTrace", {
                                    threadId: +threadId,
                                });
                                return [+threadId, stackTrace];
                            })
                    );

                    this.stackTraces = new Map(
                        pairs
                            .filter(([threadId, frame]) => frame.stackFrames.length > 0) // filter finished threads
                            .map(([threadId, frame]) => {
                                const simpleFrames = [...frame.stackFrames]
                                    .reverse()
                                    .map((frame) => ({
                                        file: frame.source!.path!,
                                        line: frame.line,
                                        name: frame.name,
                                        threadId: threadId,
                                    }));
                                return [threadId, simpleFrames];
                            })
                    );

                    this.updateVisualization();
                }
            },
            onWillStopSession: async () => {
                this.stackTraces = new Map();
                this.updateVisualization();
            }
        };
    }

    updateVisualization() {
        this.visualization?.update(async visState => {
            visState.connections = [...this.stackTraces.entries()]
                .flatMap(([threadId, frames], threadIndex) =>
                    frames
                        .filter(frame => visState.files.some(uri => frame.file == uri.fsPath))
                        .map((frame, i, arr) => ({
                            from: (i == 0) ? undefined : {
                                file: path.relative(visState.codebase.fsPath, arr[i - 1].file),
                                line: arr[i - 1].line,
                            },
                            to: {
                                file: path.relative(visState.codebase.fsPath, frame.file),
                                line: frame.line,
                            },
                            toName: frame.name,
                            threadId: threadId,
                            color: colorScheme[threadIndex % this.stackTraces.size],
                        }))
                );
        });
    }
}


// tooltip not updating whent connectiosn change
// error on update if merge rules are falses