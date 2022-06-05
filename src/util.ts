import { FileType } from 'vscode';

export interface FileTree {
    type: FileType
    name: string
    children?: FileTree[]
    size?: number
}