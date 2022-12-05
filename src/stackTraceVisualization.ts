import * as vscode from 'vscode';
import { Uri } from 'vscode';
import { API, Visualization, VisualizationSettings, Connection } from "./api";
import {DebugAdapterTracker, DebugSession} from 'vscode';
import {DebugProtocol} from 'vscode-debugprotocol';
import * as path from "path";
import _ from "lodash";


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
                const tooltips = conn.connections.map(c => `-> "${c.toName}" "${c.to!.file}:${c.to!.line}"`);
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
        },
    };

    return await cbrvAPI.create(settings);
}

class StackTraceVisualization implements vscode.DebugAdapterTrackerFactory {
    visualization?: Visualization;
    stackTrace?: {file: string, line: number, name: string}[];

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
                            name: frame.name,
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
            visState.connections = (this.stackTrace ?? [])
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
                }));
        });
    }
}
