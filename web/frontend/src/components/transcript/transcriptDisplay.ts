export interface DisplaySegment {
    start: number;
    end: number;
    text: string;
    speaker?: string;
}

export interface DisplayWord {
    start: number;
    end: number;
    word: string;
    score: number;
    speaker?: string;
}

interface DisplayTranscript {
    text: string;
    segments?: DisplaySegment[];
    word_segments?: DisplayWord[];
}

const sentenceEnd = /[。.!！?？]\s*$/;
const unfinishedEnding = /(?:一个|这个|那个|这些|那些|的|和|与|及|在|把|从|由|向|给|为|以及|包括|通过|进行)$/;

// A period produced at the end of an ASR chunk is not necessarily a sentence
// boundary. Only remove it when the same speaker resumes quickly and the
// preceding words are clearly incomplete. The stored transcript stays intact.
export function isPossibleChunkBoundary(previous: DisplaySegment, next: DisplaySegment): boolean {
    if (previous.speaker && next.speaker && previous.speaker !== next.speaker) return false;
    if (next.start - previous.end > 2 || next.start - previous.end < -0.5) return false;
    if (!sentenceEnd.test(previous.text) || !next.text.trim()) return false;
    return true;
}

export function shouldJoinChunkSentence(previous: DisplaySegment, next: DisplaySegment): boolean {
    if (!isPossibleChunkBoundary(previous, next)) return false;
    return unfinishedEnding.test(previous.text.trim().replace(sentenceEnd, ''));
}

export function prepareTranscriptForDisplay<T extends DisplayTranscript>(transcript: T): T {
    if (!transcript.segments?.length) return transcript;

    const segments = transcript.segments.map(segment => ({ ...segment }));
    const words = transcript.word_segments?.map(word => ({ ...word }));
    for (let index = 1; index < segments.length; index++) {
        const previous = segments[index - 1];
        const next = segments[index];
        if (!shouldJoinChunkSentence(previous, next)) continue;

        previous.text = previous.text.replace(sentenceEnd, '');
        if (!words?.length) continue;

        // Word alignment is unchanged: only the displayed punctuation attached
        // to the final aligned unit is removed. Its audio times stay the same.
        for (let wordIndex = words.length - 1; wordIndex >= 0; wordIndex--) {
            const word = words[wordIndex];
            if (word.start >= next.start || word.start < previous.start) continue;
            if (sentenceEnd.test(word.word)) word.word = word.word.replace(sentenceEnd, '');
            break;
        }
    }

    return {
        ...transcript,
        text: segments.map(segment => segment.text).join(''),
        segments,
        word_segments: words,
    };
}

export function shouldStartNewParagraph(previousText: string, nextText: string,
    previousStart: number, nextEnd: number): boolean {
    const tooLong = previousText.length + nextText.length > 220 || nextEnd - previousStart > 45;
    return tooLong && sentenceEnd.test(previousText);
}

export function splitDisplayWordsIntoSentences<T extends DisplayWord>(words: T[]): T[][] {
    const sentences: T[][] = [];
    let current: T[] = [];
    for (const word of words) {
        current.push(word);
        if (sentenceEnd.test(word.word)) {
            sentences.push(current);
            current = [];
        }
    }
    if (current.length) sentences.push(current);
    return sentences;
}
