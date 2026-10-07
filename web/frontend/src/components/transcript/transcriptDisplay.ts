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
    return (tooLong && sentenceEnd.test(previousText)) || previousText.length + nextText.length > 440 || nextEnd - previousStart > 90;
}

export interface RealtimeDisplaySegment {
    start: number;
    end: number;
    text: string;
    speaker?: string | null;
}

export interface RealtimeParagraph extends RealtimeDisplaySegment {
    draft: string;
}

// Rebuild from each complete response so revised speaker labels and draft text
// replace earlier results. Original segments and word timestamps remain intact.
export function groupRealtimeParagraphs(segments: RealtimeDisplaySegment[],
    partial?: RealtimeDisplaySegment | null): RealtimeParagraph[] {
    const paragraphs: RealtimeParagraph[] = [];
    function append(segment: RealtimeDisplaySegment, provisional: boolean) {
        const text = segment.text.trim();
        if (!text) return;
        const previous = paragraphs[paragraphs.length - 1];
        const gap = previous ? segment.start - previous.end : 0;
        const join = previous && (previous.speaker || null) === (segment.speaker || null)
            && gap >= -0.5 && gap <= 3
            && !shouldStartNewParagraph(previous.text, text, previous.start, segment.end);
        if (join) {
            previous.end = Math.max(previous.end, segment.end);
            if (provisional) previous.draft = text;
            else previous.text = joinRealtimeText(previous.text, text);
        } else {
            paragraphs.push({ start: segment.start, end: segment.end,
                speaker: segment.speaker || null,
                text: provisional ? '' : text, draft: provisional ? text : '' });
        }
    }
    segments.forEach(segment => append(segment, false));
    if (partial) append(partial, true);
    return paragraphs;
}

export function joinRealtimeText(previous: string, next: string): string {
    const separator = /[A-Za-z0-9]$/.test(previous) && /^[A-Za-z0-9]/.test(next) ? ' ' : '';
    return previous + separator + next;
}

export function splitDisplayWordsIntoSentences<T extends DisplayWord>(words: T[]): T[][] {
    const sentences: T[][] = [];
    let current: T[] = [];
    for (const word of words) {
        current.push(word);
        if (sentenceEnd.test(word.word) || current.map(w => w.word).join('').length >= 220) {
            sentences.push(current);
            current = [];
        }
    }
    if (current.length) sentences.push(current);
    return sentences;
}

// Shared merge path for aligned sentences and fallback ASR fragments.
// Original word indices and timestamps travel with the shifted display offsets.
export function appendReadingParagraph<T extends DisplaySegment & {
    fullText: string; offsets: Array<{startChar:number;endChar:number}>;
}>(paragraphs: T[], part: T): void {
    const previous = paragraphs[paragraphs.length - 1];
    if (!previous || (previous.speaker || null) !== (part.speaker || null) || part.start - previous.end > 8 ||
        shouldStartNewParagraph(previous.fullText, part.fullText, previous.start, part.end)) {
        paragraphs.push(part);
        return;
    }
    const separator = /[A-Za-z0-9]$/.test(previous.fullText) && /^[A-Za-z0-9]/.test(part.fullText) ? ' ' : '';
    const shift = previous.fullText.length + separator.length;
    previous.fullText += separator + part.fullText;
    previous.text = previous.fullText;
    previous.end = part.end;
    previous.offsets.push(...part.offsets.map(offset => ({...offset,
        startChar:offset.startChar+shift, endChar:offset.endChar+shift})));
}

export function shouldAttachRealtimeDraft(last: DisplaySegment | undefined,
    draft?: {text:string;start:number;end:number;speaker?:string|null}): boolean {
    return !!(last && draft?.text && draft.start-last.end <= 8 && draft.start-last.end >= -.5 &&
        (!draft.speaker || draft.speaker === last.speaker) &&
        !shouldStartNewParagraph(last.text,draft.text,last.start,draft.end));
}
