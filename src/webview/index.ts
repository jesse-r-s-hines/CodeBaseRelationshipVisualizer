import CBRVWebview from "./CBRVWebview";
import { CBRVMessage } from "../shared";
const vscode = acquireVsCodeApi();

function main() {
    let view: CBRVWebview|undefined;
    const svg = document.getElementById("diagram")!;

    addEventListener('message', event => {
        const message: CBRVMessage = event.data;
        if (message.type == "set") {
            if (!view) {
                view = new CBRVWebview(message.settings!, message.codebase!, message.connections!);
            } else {
                view.update(message.settings, message.codebase, message.connections);
            }
        } else if (message.type == "tooltip-set") {
            view!.setTooltip(message.id, message.content);
        }
    });

    // just pass events through as webview messages
    const events = ["open", "reveal-in-explorer", "copy-path", "copy-relative-path", "tooltip-request", "filter"];
    for (const type of events) {
        svg.addEventListener(`cbrv:${type}`, (event: any) => {
            vscode.postMessage({ type: type, ...event.detail });
        });
    }

    vscode.postMessage({ type: "ready" });
}

addEventListener("DOMContentLoaded", main);
