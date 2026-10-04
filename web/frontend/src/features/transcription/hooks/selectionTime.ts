export interface SelectionWordOffset {
    startChar: number;
    endChar: number;
    startTime: number;
    endTime: number;
    wordIndex: number;
}

// DOM selections use an exclusive end offset. Resolve against the text actually
// rendered in one transcript paragraph, never the original full transcript.
export function resolveSelectionTime(
    words: SelectionWordOffset[],
    startChar: number,
    endChar: number,
): { startTime: number; endTime: number; startIdx: number; endIdx: number } | null {
    if (!words.length || endChar <= startChar) return null;

    const first = words.find(word => word.startChar <= startChar && startChar < word.endChar)
        ?? words.find(word => word.startChar >= startChar);
    const lastChar = endChar - 1;
    const last = words.find(word => word.startChar <= lastChar && lastChar < word.endChar)
        ?? [...words].reverse().find(word => word.endChar <= endChar);
    if (!first || !last || first.wordIndex > last.wordIndex) return null;

    return {
        startTime: first.startTime,
        endTime: last.endTime,
        startIdx: first.wordIndex,
        endIdx: last.wordIndex,
    };
}
