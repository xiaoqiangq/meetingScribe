import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transform } from 'esbuild';

const source = await readFile(new URL('./transcriptDisplay.ts', import.meta.url), 'utf8');
const compiled = await transform(source, { loader: 'ts', format: 'esm' });
const { prepareTranscriptForDisplay, shouldStartNewParagraph, splitDisplayWordsIntoSentences } = await import(
    `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`
);

test('joins an unfinished sentence across an ASR chunk without changing timestamps', () => {
    const original = {
        text: '我们还是遵循那个经典的一个。生理病理的一个过程的一个特点呢，',
        segments: [
            { start: 10, end: 15, speaker: 'speaker_1', text: '我们还是遵循那个经典的一个。' },
            { start: 15.2, end: 20, speaker: 'speaker_1', text: '生理病理的一个过程的一个特点呢，' },
        ],
        word_segments: [
            { start: 14, end: 15, word: '个。', score: 0, speaker: 'speaker_1' },
            { start: 15.2, end: 15.5, word: '生', score: 0, speaker: 'speaker_1' },
        ],
    };
    const displayed = prepareTranscriptForDisplay(original);
    assert.equal(displayed.segments[0].text, '我们还是遵循那个经典的一个');
    assert.equal(displayed.word_segments[0].word, '个');
    assert.equal(displayed.word_segments[0].start, 14);
    assert.equal(displayed.word_segments[0].end, 15);
    assert.equal(original.segments[0].text, '我们还是遵循那个经典的一个。');
    assert.equal(shouldStartNewParagraph(displayed.segments[0].text, displayed.segments[1].text, 0, 50), false);
    assert.deepEqual(
        splitDisplayWordsIntoSentences(displayed.word_segments).map(sentence => sentence.map(word => word.word).join('')),
        ['个生']
    );
});

test('retains punctuation at a speaker change or real sentence ending', () => {
    const changedSpeaker = prepareTranscriptForDisplay({
        text: '',
        segments: [
            { start: 0, end: 2, speaker: 'speaker_1', text: '这是一个。' },
            { start: 2.1, end: 4, speaker: 'speaker_2', text: '新的问题。' },
        ],
    });
    assert.equal(changedSpeaker.segments[0].text, '这是一个。');

    const completeSentence = prepareTranscriptForDisplay({
        text: '',
        segments: [
            { start: 0, end: 2, speaker: 'speaker_1', text: '这个问题讲完了。' },
            { start: 2.1, end: 4, speaker: 'speaker_1', text: '接下来讨论别的。' },
        ],
    });
    assert.equal(completeSentence.segments[0].text, '这个问题讲完了。');
    assert.equal(shouldStartNewParagraph('这个问题讲完了。', '接下来讨论别的。', 0, 50), true);
});

test('does not join across a long pause', () => {
    const displayed = prepareTranscriptForDisplay({
        text: '',
        segments: [
            { start: 0, end: 2, text: '我准备了一个。' },
            { start: 5, end: 7, text: '新的报告。' },
        ],
    });
    assert.equal(displayed.segments[0].text, '我准备了一个。');
});

test('starts reading paragraphs only after a sentence, not at the character limit', () => {
    const words = [
        { start: 0, end: 1, word: '前一句。', score: 0 },
        { start: 1, end: 2, word: '我们还是遵循那个经典的一个', score: 0 },
        { start: 2, end: 3, word: '生理病理的一个过程的一个特点呢。', score: 0 },
    ];
    assert.deepEqual(splitDisplayWordsIntoSentences(words).map(sentence => sentence.length), [1, 2]);
    assert.equal(shouldStartNewParagraph('我们还是遵循那个经典的一个', words[2].word, 0, 50), false);
    assert.equal(shouldStartNewParagraph('前一句。', words[1].word, 0, 50), true);
});
