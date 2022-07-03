/** Contains interfaces and classes that are used both inside and outside the webview */

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
 * Represents a connection or relationship between files. A `Connection` connects two file:line locations in the
 * workspace. `Connections` will be rendered as a line or arrow in the visualization. `line` is optional, in which case
 * the `Connection` will just connect the files and can be passed just the file `Uri`. `Connections` can be between two
 * different files, different lines in the same file, or even connect a file to itself. `Connections` can only connect
 * files, not folders. If `from` or `to` is undefined, the connection will start or end "outside" the visualization.
 * 
 * E.g.
 * ```ts
 * {
 *   from: {file: Uri.file("main.py"), line: 10},
 *   to: {file: Uri.file("tutorial.py"), line: 3}
 * }
 * ```
 * or
 * ```ts
 * {
 *   from: Uri.file("main.py"),
 *   to: Uri.file("tutorial.py")
 * }
 * ```
 */
 export interface Connection {
    from: Endpoint
    to: Endpoint
}

/**
 * Represents one endpoint of a `Connection`. Can be a path to the file or an object containing a path and an optional
 * line number.
 * TODO: maybe use Uri instead
 */
export type Endpoint = string | { file: string, line?: number }
