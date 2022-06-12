import CBRVWebview from "./CBRVWebview";
const vscode = acquireVsCodeApi();

let view: CBRVWebview|undefined;

function main() {
    addEventListener('message', event => {
        const message = event.data;
        if (message.type == "set-codebase") {
            view = new CBRVWebview("#canvas", message.codebase);
        }
    });

    vscode.postMessage({ type: "ready" });
}


addEventListener("DOMContentLoaded", main);
