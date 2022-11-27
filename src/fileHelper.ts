import * as vscode from 'vscode';
import { Uri } from "vscode";
import * as path from 'path';
import { promises as fsp } from 'fs';
import { AnyFile, Directory, FileType } from "./privateTypes";
import _ from "lodash";


/** Creates a AnyFile object of type. */
async function createAnyFile(type: FileType, uri: Uri, base: Uri, stat?: vscode.FileStat): Promise<AnyFile> {
    const name = path.basename(uri.fsPath);
    if (type == FileType.Directory) {
        return { type, name, children: [] };
    } else if (type == FileType.File) {
        stat = stat ?? await vscode.workspace.fs.stat(uri);
        return { type, name, size: Math.max(stat.size, 1) };
    // FileType enum is bit-flagged together for Symlink files/directories
    } else if ((type & FileType.SymbolicLink) === FileType.SymbolicLink) {
        const realpath = await fsp.realpath(uri.fsPath);
        let resolved = path.relative(base.fsPath, realpath);
        if (resolved.split(path.sep)[0] == "..") { 
            resolved = realpath; // resolved is relative to base unless link is outside, then its absolute
        }
        return {
            type: FileType.SymbolicLink,
            linkedType: type & ~FileType.SymbolicLink, // remove flag to make a single value
            name,
            link: await fsp.readlink(uri.fsPath),
            resolved,
        };
    } else {
        throw new Error("Other filetypes not supported"); // TODO
    }
}

/**
 * Returns a tree of all the files under uri
 * Children of each directory will be sorted by name.
 */
export async function getFileTree(uri: Uri, base?: Uri, type?: FileType): Promise<AnyFile> {
    type = type ?? (await vscode.workspace.fs.stat(uri)).type;
    base = base ?? uri;

    if (type == FileType.Directory) {
        const files = await vscode.workspace.fs.readDirectory(uri);
        const children = await Promise.all(files.map(
            ([name, type]) => getFileTree(Uri.joinPath(uri, name), base, type)
        ));
        const folder = await createAnyFile(type, uri, base) as Directory;
        return {...folder, children: _.sortBy(children, f => f.name)};
    } else {
        return await createAnyFile(type, uri, base);
    }
}

/** Gets a list of files under base with similar semantics as the built-in VSCode search interface. */
export async function getFilteredFileList(base: Uri, include?: string, exclude?: string): Promise<Uri[]> {
    // TODO this means you can't use {} in the globals since you can't nest {}.
    // Also you can't pass a whole folder as part of include/exclude either.
    // Exceptions?
    // See:
    //    - https://stackoverflow.com/questions/38063144/can-you-pass-multiple-glob-strings-to-vscode-findfiles-api
    //    - https://github.com/Microsoft/vscode/issues/32761
    //    - https://github.com/microsoft/vscode/commit/97fc799b6f5e87e8a808a802c3a341c75d4fc180
    //    - vscode/src/vs/workbench/services/search/common/queryBuilder.ts

    const parseGlob = (glob: string) => {
        glob = `{${glob.split(",").map(g => g.trim()).join(",")}}`;
        return new vscode.RelativePattern(base, glob);
    };

    const includePattern = parseGlob(include?.trim() ? include : '**/*');
    const excludePattern = exclude?.trim() ? parseGlob(exclude) : undefined;
    let fileList = await vscode.workspace.findFiles(includePattern, excludePattern);
    fileList = _.sortBy(fileList, uri => uri.fsPath);
    return fileList;
}

/** Gets a file tree of base with similar semantics as the built-in VSCode search interface. */
export async function getFilteredFileTree(base: Uri, include?: string, exclude?: string): Promise<AnyFile> {
    return await listToFileTree(base, await getFilteredFileList(base, include, exclude));
}

/**
 * Takes a list of Uri and converts it into a file tree starting at base. Uris should be absolute.
 * Children of each directory will be sorted by name.
 */
export async function listToFileTree(base: Uri, uris: Uri[]): Promise<Directory> {
    // expand paths to include directories that are only referenced by being part of another path.
    const paths = _(uris)
        .flatMap(uri => {
            const parts = path.relative(base.fsPath, uri.fsPath).split(path.sep);
            if (parts[0] == '..') {
                throw new Error(`"${uri.fsPath}" is not under "${base.fsPath}"`);
            }
            return parts.map((s, i, arr) => Uri.joinPath(base, ...arr.slice(0, i + 1)));
        })
        .sortBy(p => p.fsPath) // Sorting by string path will make sure that directories occur before their children.
        .sortedUniqBy(p => p.fsPath) // uniq optimized for sorted
        .value();

    // query all the stat data asynchronously
    const flat = await Promise.all(
        paths.map(async (uri): Promise<[string, AnyFile]> => {
            const stat = await vscode.workspace.fs.stat(uri);
            return [uri.fsPath, await createAnyFile(stat.type, uri, base, stat)];
        })
    );

    // TODO symlink base?
    const tree: Directory = await createAnyFile(FileType.Directory, base, base) as Directory;

    // build a tree. flat is in sorted order, so directories will show up before their children.
    for (const [fsPath, file] of flat) {
        const parts = path.relative(base.fsPath, fsPath).split(path.sep);
        let dir: Directory = tree;
        let include = true;

        for (const part of parts.slice(0, -1)) {
            const found = dir.children.find(f => f.name == part);
            if (found?.type === FileType.SymbolicLink) {
                include = false;
                break; // skip files under a symbolic link directory so they aren't included twice.
            } else if (found?.type != FileType.Directory) {
                // this shouldn't be possible except with maybe a race condition deleting/modifying a folder?
                throw new Error(`Error building tree on file ${fsPath}`);
            }
            dir = found;
        }

        if (include) {
            dir.children.push(file);
        }
    }

    return tree;
}
