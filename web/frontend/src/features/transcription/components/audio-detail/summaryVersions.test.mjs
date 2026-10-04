import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transform } from 'esbuild';

const compiled = await transform(await readFile(new URL('./summaryVersions.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm' });
const { cleanSummaryAnnotations } = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);

test('clean version strips source intervals and parenthesized roles, retaining names and content', () => {
    const original = '张三（topic1/speaker_1）：明确方向。[00:00:04.080–00:05:44.595]\n李四 (topic2/speaker_3) 提议推进 [00:53:00]。';
    assert.equal(cleanSummaryAnnotations(original), '张三：明确方向。\n李四 提议推进。');
    assert.ok(original.includes('topic1/speaker_1'));
});

test('retains business dates, times, parentheses, numbers and unknown speaker identities', () => {
    const text = '2026-10-03 下午 14:30 开始；(GLP-1) 数据为 29%；[待确认]。topic2/speaker_2：建议。';
    assert.equal(cleanSummaryAnnotations(text), text);
    assert.equal(cleanSummaryAnnotations('张三（topic1/speaker_0、topic2/speaker_1） [00:40:00.100-00:41:00.200]：同意'), '张三：同意');
    assert.equal(cleanSummaryAnnotations('张三（topic1/speaker_2；topic2/speaker_1）。来源：张三，[00:00:04.080–00:05:44.595]、[00:05:46.710–00:10:13.165]。'), '张三。');
});

test('removes source sentences, keeping surrounding discussion and speaker names', () => {
    assert.equal(cleanSummaryAnnotations('王五汇报方案。来源：王五。张三建议调整。'), '王五汇报方案。张三建议调整。');
    assert.equal(cleanSummaryAnnotations('正文。 **来源：**张三，[00:00:04.080–00:05:44.595]。'), '正文。');
    assert.equal(cleanSummaryAnnotations('正文（来源：李四）。'), '正文。');
    assert.equal(cleanSummaryAnnotations('原料来源和采购需确认。'), '原料来源和采购需确认。');
    assert.equal(cleanSummaryAnnotations('原料来源：本地供应商。'), '原料来源：本地供应商。');
});
