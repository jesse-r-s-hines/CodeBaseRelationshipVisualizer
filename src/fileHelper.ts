import * as vscode from 'vscode';
import { Uri } from "vscode";
import * as path from 'path';
import { AnyFile, Directory, FileType } from "./shared";
import _ from "lodash";

/**
 * Returns a tree of all the files under uri
 * Children of each directory will be sorted name.
 */
export async function getFileTree(uri: Uri, type?: FileType): Promise<AnyFile> {
    type = type ?? (await vscode.workspace.fs.stat(uri)).type;
    const name = path.basename(uri.fsPath);
    if (type == FileType.Directory) {
        const files = await vscode.workspace.fs.readDirectory(uri);
        const children = await Promise.all(files.map(([name, type]) => getFileTree(Uri.joinPath(uri, name), type)));
        return { type, name, children: _.sortBy(children, f => f.name) };
    } else if (type == FileType.File) {
        return { type, name, size: Math.max((await vscode.workspace.fs.stat(uri)).size, 1) };
    } else {
        throw new Error("Other file types not supported"); // TODO: handle symlinks and other special files
    }
}

/** Gets a file tree from base with similar semantics as the built-in VSCode search interface. */
export async function getFilteredFileTree(base: Uri, include?: string, exclude?: string) {
    // TODO this means you can't use {} in the globals since you can't nest {}
    // also you can't pass a whole folder as part of include/exclude either.
    // Exceptions?
    // See: https://stackoverflow.com/questions/38063144/can-you-pass-multiple-glob-strings-to-vscode-findfiles-api
    // https://github.com/Microsoft/vscode/issues/32761
    // https://github.com/microsoft/vscode/commit/97fc799b6f5e87e8a808a802c3a341c75d4fc180
    // vscode/src/vs/workbench/services/search/common/queryBuilder.ts

    const parseGlob = (glob: string) => {
        glob = `{${glob.split(",").map(g => g.trim()).join(",")}}`;
        return new vscode.RelativePattern(base, glob);
    };

    const includePattern = parseGlob(include?.trim() ? include : '**/*');
    const excludePattern = exclude?.trim() ? parseGlob(exclude) : undefined;
    const fileList = await vscode.workspace.findFiles(includePattern, excludePattern);
    return listToFileTree(base, fileList);
}

/**
 * Takes a list of Uri and converts it into a file tree starting at base. Uris should be absolute.
 * Children of each directory will be sorted name.
 */
export async function listToFileTree(base: Uri, uris: Uri[]): Promise<Directory> {
    // query all the stat data asynchronously
    const flat: [string, AnyFile][] = await Promise.all(uris.map(async uri => {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.type == FileType.Directory) {
            return [uri.fsPath, { type: stat.type, name: path.basename(uri.fsPath), children: [] }];
        } else if (stat.type == FileType.File) {
            return [uri.fsPath, { type: stat.type, name: path.basename(uri.fsPath), size: Math.max(stat.size, 1)}];
        } else {
            throw new Error("Other filetypes not supported"); // TODO
        }
    }));

    const addChild = (dir: Directory, f: AnyFile) => // insert in sorted order
        dir.children.splice(_.sortedIndexBy(dir.children, f, c => c.name), 0, f);

    const tree: Directory = { type: FileType.Directory, name: path.basename(base.fsPath), children: [] };

    for (let [filePath, file] of flat) {
        const parts = path.relative(base.fsPath, filePath).split(path.sep);
        let dir = tree;
        for (let part of parts.slice(0, -1)) {
            let found = dir.children.find(f => f.name == part);
            if (found == undefined) {
                found = { type: FileType.Directory, name: part,  children: [] };
                addChild(dir, found);
            }
            if (found.type != FileType.Directory) {
                // this shouldn't be possible except with maybe a race condition on changing a fplder to a file
                throw new Error(`Conflict on file ${filePath}`);
            } else {
                dir = found;
            }
        }
        addChild(dir, file);
    }

    return tree;
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