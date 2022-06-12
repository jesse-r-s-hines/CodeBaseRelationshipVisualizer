import CBRVWebview from "./CBRVWebview";

let view: CBRVWebview|undefined;

addEventListener('message', event => {
    const message = event.data;
    if (message.type == "set-codebase") {
        view = new CBRVWebview("#canvas", message.codebase);
    }
});