import * as vscode from 'vscode';
import { Uri } from "vscode";
import * as path from 'path';
import { AnyFile, Directory, FileType } from "./shared";

export async function getWorkspaceFileTree(): Promise<Directory | undefined> {
    if (vscode.workspace.workspaceFolders !== undefined) {
        const base = vscode.workspace.workspaceFolders[0].uri;
        return await getFileTree(base, FileType.Directory) as any; // will always be a Directory
    } else {
        return undefined;
    }
}

export async function getFileTree(uri: Uri, type?: FileType): Promise<AnyFile> {
    type = type ?? (await vscode.workspace.fs.stat(uri)).type;
    const name = path.basename(uri.fsPath);
    if (type == FileType.Directory) {
        const files = await vscode.workspace.fs.readDirectory(uri);
        const children = await Promise.all(files.map(([name, type]) => getFileTree(Uri.joinPath(uri, name), type)));
        return { type, name, children: children };
    } else if (type == FileType.File) {
        return { type, name, size: Math.max((await vscode.workspace.fs.stat(uri)).size, 1) };
    } else {
        throw new Error("Other file types not supported"); // TODO: handle symlinks and other special files
    }
}