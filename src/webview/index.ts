import CBRVWebview from "./CBRVWebview";
import { CBRVMessage } from "../privateTypes";
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
    svg.addEventListener(`cbrv:send`, (event: any) => {
        vscode.postMessage(event.detail);
    });

    vscode.postMessage({ type: "ready" });
}

addEventListener("DOMContentLoaded", main);
