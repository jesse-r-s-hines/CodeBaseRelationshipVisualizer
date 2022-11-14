import * as path from 'path';

import { runTests } from '@vscode/test-electron';
// See https://code.visualstudio.com/api/working-with-extensions/testing-extension

async function main() {
    try {
        // I can't find a built-in way to get workspaceFolder. __dirname is .../CBRV/dist/test/test/integration
        const workspaceFolder = __dirname.split("/").slice(0, -4).join("/")
        // Opening files in the tests with `vscode.commands.executeCommand("vscode.openFolder", ...)` doesn't work
        // reliably. It sometimes works and sometimes doesn't, even with manual sleeps. And it starts a new VSCode
        // instance, which breaks the debugger. So we're just open sample-codebases here in the launch script.

        // The folder containing the Extension Manifest package.json
        // Passed to `--extensionDevelopmentPath`
        const extensionDevelopmentPath = path.resolve(__dirname, '../../');

        // The path to test runner
        // Passed to --extensionTestsPath
        const extensionTestsPath = path.resolve(__dirname, './index');

        // Download VS Code, unzip it and run the integration test
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [
                `${workspaceFolder}/test/sample-codebases`, // open sample-codebases folder
                '--disable-extensions',
            ],
        });
    } catch (err) {
        console.error('Failed to run tests');
        process.exit(1);
    }
}

main();
