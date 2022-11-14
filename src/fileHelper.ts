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

/** Returns a tree of all the files under uri */
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

/** Returns the set of the paths of all files under base, relative to base. Folders will not be in the set. */
export async function getPathSet(base: Uri): Promise<Set<string>> {
    const type = (await vscode.workspace.fs.stat(base)).type;
    const pathSet = new Set<string>();
    await pathSetHelper(pathSet, base, [], type);
    return pathSet;
}

async function pathSetHelper(pathSet: Set<string>, base: Uri, parts: string[], type: FileType): Promise<void> {
    if (type == FileType.Directory) {
        const children = await vscode.workspace.fs.readDirectory(Uri.joinPath(base, ...parts));
        await Promise.all(
            children.map(([name, subType]) => 
                pathSetHelper(pathSet, base, [...parts, name], subType)
            )
        );
    } else if (type == FileType.File) {
        pathSet.add(parts.join("/"));
    } else {
        throw new Error("Other file types not supported"); // TODO
    }
}