import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transform } from 'esbuild';

const compiled = await transform(await readFile(new URL('./summaryTranscript.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm' });
const { formatSummaryTranscript, buildSummaryContent } = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);

test('uses word roles inside a mixed-speaker ASR chunk without losing text', () => {
    const transcript = {
        text: '同意。请调整。',
        segments: [{ start: 0, end: 4, text: '同意。请调整。', speaker: 'topic1/speaker_0' }],
        word_segments: [
            { start: 0, end: 0.5, word: '同', speaker: 'topic1/speaker_0' },
            { start: 0.5, end: 1, word: '意。', speaker: 'topic1/speaker_0' },
            { start: 1, end: 4, word: '请调整。', speaker: 'topic1/speaker_1' },
        ],
    };
    const original = structuredClone(transcript);
    assert.equal(formatSummaryTranscript(transcript, { 'topic1/speaker_0': '张三', 'topic1/speaker_1': '李四' }),
        '[00:00:00.000–00:00:01.000] 张三（topic1/speaker_0）：同意。\n[00:00:01.000–00:00:04.000] 李四（topic1/speaker_1）：请调整。');
    assert.deepEqual(transcript, original);
});

test('keeps topic labels distinct even when names match, and preserves unknown roles', () => {
    const result = formatSummaryTranscript({ text: '', word_segments: [
        { start: 2579, end: 2580, word: '前。', speaker: 'topic1/speaker_0' },
        { start: 2580, end: 2581, word: '后。', speaker: 'topic2/speaker_0' },
        { start: 2581, end: 2582, word: '未知。', speaker: 'topic2/speaker_2' },
        { start: 2582, end: 2583, word: '未标注。' },
    ] }, { 'topic1/speaker_0': '张三', 'topic2/speaker_0': '张三', 'topic2/speaker_2': 'topic2/speaker_2' });
    assert.equal(result.split('\n').length, 4);
    assert.match(result, /00:43:00.000.*张三（topic2\/speaker_0）/);
    assert.match(result, /topic2\/speaker_2：未知。/);
    assert.match(result, /未标注说话人：未标注。/);
});

test('supports segment-only and plain-text historical transcripts', () => {
    const result = formatSummaryTranscript({ text: '甲乙', segments: [
        { start: 0, end: 1, text: '甲', speaker: 'speaker_0' },
        { start: 10, end: 11, text: '乙', speaker: 'speaker_0' },
    ] }, {});
    assert.equal(result.split('\n').length, 2);
    assert.match(result, /speaker_0：甲/);
    assert.equal(formatSummaryTranscript({ text: '纯文本' }, {}), '未提供说话人及时间信息：\n纯文本');
    assert.match(buildSummaryContent(result, '整理决议'), /Instructions:\n整理决议/);
    assert.match(buildSummaryContent(result, '整理决议'), /区分发言人、被提及的人和行动项负责人/);
});
