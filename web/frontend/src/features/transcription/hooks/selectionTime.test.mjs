import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transform } from 'esbuild';

const source = await readFile(new URL('./selectionTime.ts', import.meta.url), 'utf8');
const compiled = await transform(source, { loader: 'ts', format: 'esm' });
const { resolveSelectionTime } = await import(
    `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`
);

test('double-click in a later displayed paragraph seeks to its local word time', () => {
    const paragraph = [
        { startChar: 0, endChar: 1, startTime: 754.66, endTime: 754.74, wordIndex: 3843 },
        { startChar: 1, endChar: 2, startTime: 754.74, endTime: 754.82, wordIndex: 3844 },
        { startChar: 2, endChar: 3, startTime: 754.82, endTime: 754.98, wordIndex: 3845 },
    ];
    assert.deepEqual(resolveSelectionTime(paragraph, 1, 2), {
        startTime: 754.74, endTime: 754.82, startIdx: 3844, endIdx: 3844,
    });
});

test('exclusive selection end does not take the following word', () => {
    const paragraph = [
        { startChar: 0, endChar: 2, startTime: 10, endTime: 10.4, wordIndex: 4 },
        { startChar: 2, endChar: 4, startTime: 20, endTime: 20.4, wordIndex: 5 },
    ];
    assert.deepEqual(resolveSelectionTime(paragraph, 0, 2), {
        startTime: 10, endTime: 10.4, startIdx: 4, endIdx: 4,
    });
    assert.deepEqual(resolveSelectionTime(paragraph, 2, 4), {
        startTime: 20, endTime: 20.4, startIdx: 5, endIdx: 5,
    });
});

test('selection in inserted spacing uses the next spoken word', () => {
    const paragraph = [
        { startChar: 0, endChar: 3, startTime: 10, endTime: 10.4, wordIndex: 4 },
        { startChar: 4, endChar: 7, startTime: 20, endTime: 20.4, wordIndex: 5 },
    ];
    assert.equal(resolveSelectionTime(paragraph, 3, 7)?.startTime, 20);
});
