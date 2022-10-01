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
    from?: Endpoint
    to?: Endpoint

    /** Width of the SVG path */
    width?: number

     /** CSS color string */
     color?: string
}

/**
 * Represents one endpoint of a `Connection`. Can be a path to the file or an object containing a path and an optional
 * line number.
 * TODO: maybe use Uri instead
 */
export type Endpoint = string | { file: string, line?: number }

/**
 * Settings and configuration for a Visualization.
 */
 export interface VisualizationSettings {
    /**
     * Title for the internal webview. See https://code.visualstudio.com/api/references/vscode-api#WebviewPanel
     */
    title: string

    /**
     * Whether each connection is directed (an arrow) or not (a line).
     * Default false.
     */
    directed: boolean

    /** Default width of the SVG path for connections. Can be overridden per connection via `Connection.width` */
    connectionWidth: number

    /** Default CSS color string for connections. Can be overridden per connection via `Connection.color` */
    connectionColor: string
}

 /**
  * Represents a merged group of connections, that will be rendered as one
  * line in the visualization. The connections are grouped together based
  * on the merge rules.
  */
  export interface MergedConnections {
    /**
    * The file/folder the rendered connection will show from. This can be a
    * folder when there are deeply nested files which are hidden until the
    * user zooms in. Then connections to those files will show connected to
    * the visible parent folder.
    */
    from?: NormalizedEndpoint

    /**
    * The file or folder the rendered connection will show to. Can be a
    * folder just like `from`.
    */
    to?: NormalizedEndpoint

    /**
    * The original connections that were merged.
    * Will be sorted using the order function if one is given.
    */
    connections: Connection[]
  }

// Internal types

export interface NormalizedConnection {
    from?: NormalizedEndpoint
    to?: NormalizedEndpoint
    width?: number
    color?: string
}

export type NormalizedEndpoint = { file: string, line?: number }
