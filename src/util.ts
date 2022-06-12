/**
 * Just an alias for VSCode's FileType enum.
 * I've redeclared it from scratch here so that it can be used inside the webview (vscode isn't available there)
 */
 export enum FileType {
    Unknown = 0,
    File = 1,
    Directory = 2,
    SymbolicLink = 64
}

/**
 * An abstract representation of files and directories that can be sent to the webview.
 */
export type AnyFile = File | Directory

interface BaseFile {
    name: string
}

export interface File extends BaseFile {
    type: FileType.File
    size: number
}

export interface Directory extends BaseFile {
    type: FileType.Directory
    children: AnyFile[]
}

/**
 * Returns the extension from a file name excluding the ".", or "" if there is none.
 * Hidden files count as having no extension
 */
export function getExtension(filename: string): string {
    const dotPos = filename.lastIndexOf(".");
    return dotPos > 0 ? filename.slice(dotPos + 1) : ""; // TODO hidden files and such?
}