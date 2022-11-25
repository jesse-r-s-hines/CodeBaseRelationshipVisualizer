/** Contains interfaces and classes internal to CBRV that are can be used both inside and outside the webview */

import { NormalizedConnection, MergedConnection, MergeRules } from "./publicTypes";

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
    connectionDefaults: {
        width: number
        color: string
    }
    mergeRules: MergeRules|false
}

// messages for communication between the webview and VSCode
export type CBRVMessage = ReadyMessage|SetMessage|OpenMessage|RevealInExplorerMessage|CopyPathMessage|
                          CopyRelativePathMessage|TooltipRequestMessage|TooltipSetMessage|FilterMessage
export type ReadyMessage = { type: "ready" }
export type SetMessage = {
    type: "set",
    settings?: WebviewVisualizationSettings,
    codebase?: Directory,
    connections?: NormalizedConnection[],
}
export type OpenMessage = { type: "open", file: string }
export type RevealInExplorerMessage = { type: "reveal-in-explorer", file: string }
export type CopyPathMessage = { type: "copy-path", file: string }
export type CopyRelativePathMessage = {type: "copy-relative-path", file: string }
export type TooltipRequestMessage = { type: "tooltip-request", id: string, conn: MergedConnection }
export type TooltipSetMessage = { type: "tooltip-set", id: string, content: string }
export type FilterMessage = { type: "filter", include: string, exclude: string }
