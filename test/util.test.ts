import {describe, expect, test} from '@jest/globals';
import { getExtension } from '../src/util';
import { distance } from '../src/webview/rendering';

test('adds 1 + 2 to equal 3', () => {
    expect(getExtension("a.txt")).toBe("txt");
    expect(distance([1, 2], [1, 3])).toBe(1);
});
