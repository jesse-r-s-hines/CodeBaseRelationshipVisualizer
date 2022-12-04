import * as path from 'path';
import { promises as fs } from 'fs';
import * as os from 'os';
import { Uri } from 'vscode';

/**
 * Pass an object of relative file path keys and file content values and it will create a temp dir with those files and
 * directories under it.
 */
export async function writeFileTree(files: Record<string, string>): Promise<Uri> {
    const tempdir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-'));
    for (const [relativePath, content] of Object.entries(files)) {
        await fs.mkdir(path.join(tempdir, path.dirname(relativePath)), {recursive: true});
        await fs.writeFile(path.join(tempdir, relativePath), content);
    }
    return Uri.file(tempdir);
}