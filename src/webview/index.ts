import CBRVWebview from "./CBRVWebview";
const vscode = acquireVsCodeApi();

let view: CBRVWebview|undefined;

function main() {
    addEventListener('message', event => {
        const message = event.data;
        if (message.type == "set") {
            if (!view) {
                view = new CBRVWebview("#canvas", message.codebase, message.settings, message.connections);
            } else {
                view.update(message.settings, message.codebase, message.connections);
            }
        }
    });

    vscode.postMessage({ type: "ready" });
}

addEventListener("DOMContentLoaded", main);
