/** Contains interfaces and classes internal to CBRV that are can be used both inside and outside the webview */

import { MergeRules } from "./publicTypes";

/**
 * Represents a merged group of connections, that will be rendered as one
 * line in the visualization. The connections are grouped together based
 * on the merge rules.
 */
 export interface WebviewMergedConnection { // TODO reduce duplication with public MergedConnection
    /**
    * The file/folder the rendered connection will show from. This can be a
    * folder when there are deeply nested files which are hidden until the
    * user zooms in. Then connections to those files will show connected to
    * the visible parent folder.
    */
    from?: WebviewEndpoint

    /**
    * The file or folder the rendered connection will show to. Can be a
    * folder just like `from`.
    */
    to?: WebviewEndpoint

    /** True if this merged connection represents connections going both directions between from and to */
    bidirectional: boolean

    width: number
    color: string
    tooltip?: string

    /**
    * The original connections that were merged.
    * Will be sorted using the order function if one is given.
    */
    connections: WebviewConnection[]

    [key: string]: any
}

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
export type AnyFile = File | Directory | SymbolicLink

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
 * Note that while VSCode handles SymbolicLink types as a bitmask with File or Directory, I'm spliting the bitmask into
 * separate fields to make it easier to work with and do type inference in the Visualization.
 */
export interface SymbolicLink extends BaseFile {
    type: FileType.SymbolicLink
    linkedType: FileType.Directory|FileType.File
    link: string
    resolved: string // resolved path relative to your codebase, or full path if external.
}


export interface WebviewVisualizationSettings {
    directed: boolean
    showOnHover: "in"|"out"|"both"|false
    hideUnconnected: boolean,
    connectionDefaults: {
        width: number
        color: string
    }
    mergeRules: MergeRules|false
    contextMenu: {
        file: WebviewContextMenuItem[],
        directory: WebviewContextMenuItem[],
    }
}

export interface WebviewConnection {
    from?: WebviewEndpoint
    to?: WebviewEndpoint
    width?: number
    color?: string
    tooltip?: string
    [key: string]: any
}

export type WebviewEndpoint = { file: string, line?: number }


export type WebviewContextMenuItem = {title: string, action: string}

// messages for communication between the webview and VSCode
export type CBRVMessage = ReadyMessage|SetMessage|OpenMessage|RevealInExplorerMessage|TooltipRequestMessage|
                          TooltipSetMessage|FilterMessage|ContextMenuActionMessage
export type ReadyMessage = { type: "ready" }
export type SetMessage = {
    type: "set",
    settings?: WebviewVisualizationSettings,
    codebase?: Directory,
    connections?: WebviewConnection[],
}
export type OpenMessage = { type: "open", file: string }
export type RevealInExplorerMessage = { type: "reveal-in-explorer", file: string }
export type TooltipRequestMessage = {
    type: "tooltip-request",
    id: string,
    // send merged connection, but with indexes instead of the conns (so we can map them back to server side conns)
    conn: MappedOmit<WebviewMergedConnection, 'connections'> & {connections: number[]},
}
export type TooltipSetMessage = { type: "tooltip-set", id: string, content: string }
export type FilterMessage = { type: "filter", include: string, exclude: string }
export type ContextMenuActionMessage = {
    type: "context-menu-action",
    action: string,
    file: string,
}


/** Like omit, but will work with mapped types. TODO move somewhere else. */
export type MappedOmit<T, Keys> = {
    [K in keyof T as (K extends Keys ? never : K)]: T[K]
}
