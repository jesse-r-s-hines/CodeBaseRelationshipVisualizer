import * as vscode from 'vscode';
import {DebugAdapterTracker, DebugSession} from 'vscode'
import {DebugProtocol} from 'vscode-debugprotocol'


export function activate(context: vscode.ExtensionContext) {
    console.log("Code Structure Visualization active")
    vscode.debug.registerDebugAdapterTrackerFactory("*", new MyDebugAdapterTrackerFactory())

    context.subscriptions.push(
        vscode.commands.registerCommand('codeStructureVisualization.start', () => {
            // Create and show panel
            const panel = vscode.window.createWebviewPanel(
                'codeStructureVisualization',
                'Code Structure Visualization',
                vscode.ViewColumn.One,
                {
                  enableScripts: true
                }
            );

            // And set its HTML content
            panel.webview.html = getWebviewContent();
          })
    );
}

class MyDebugAdapterTrackerFactory implements vscode.DebugAdapterTrackerFactory {
    createDebugAdapterTracker(session: DebugSession): DebugAdapterTracker {
        return {
            async onDidSendMessage(msg: DebugProtocol.ProtocolMessage) {
                if (msg.type == "event" && (msg as DebugProtocol.Event).event == "stopped") {
                    let stoppedMsg = msg as DebugProtocol.StoppedEvent
                    const threadId = stoppedMsg.body.threadId
                    let reply = await session.customRequest("stackTrace", {
                        threadId: threadId,
                    }) as DebugProtocol.StackTraceResponse;
                    console.log(reply)
                }
            }
        }
    }
}

function getWebviewContent() {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Circle</title>
            <script src="https://d3js.org/d3.v7.min.js"></script>
        </head>
        <body>
            <svg id="canvas"></svg>
            <script>
                let [width, height] = [1000, 1000]
            
                const canvas = d3.select("#canvas")
                    .attr("viewBox", [0, 0, width, height])
                    .style("font", "10px sans-serif")
                    .attr("text-anchor", "middle");
        
                canvas.append("circle")
                    .attr("r", 450)
                    .attr("cx", 500).attr("cy", 500)
                    .attr("fill", "blue");
            </script>
        </body>
        </html>
  `  
}