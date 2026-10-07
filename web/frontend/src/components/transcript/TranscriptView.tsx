import { t as translateUI } from "@/i18n";
import { forwardRef, useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useKaraokeHighlight, computeWordOffsets, findActiveWordIndex } from '@/features/transcription/hooks/useKaraokeHighlight';
import { cn } from '@/lib/utils';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import type { Note } from '@/types/note';
import { prepareTranscriptForDisplay, appendReadingParagraph, shouldAttachRealtimeDraft, splitDisplayWordsIntoSentences } from './transcriptDisplay';
// Helper for cross-browser caret position
function getCaretOffsetFromPoint(x: number, y: number) {
    if (document.caretRangeFromPoint) {
        const range = document.caretRangeFromPoint(x, y);
        return range ? range.startOffset : null;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((document as any).caretPositionFromPoint) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pos = (document as any).caretPositionFromPoint(x, y);
        return pos ? pos.offset : null;
    }
    return null;
}
interface WordSegment {
    start: number;
    end: number;
    word: string;
    score: number;
    speaker?: string;
}
interface Transcript {
    realtime?: boolean;
    text: string;
    segments?: Array<{
        start: number;
        end: number;
        text: string;
        speaker?: string;
    }>;
    word_segments?: WordSegment[];
}
type ExpandedSegment = NonNullable<Transcript['segments']>[number] & {
    fullText: string;
    offsets: ReturnType<typeof computeWordOffsets>['offsets'];
};
interface TranscriptViewProps {
    transcript: Transcript | null;
    livePartial?: {text:string;start:number;end:number;speaker?:string|null};
    mode: 'compact' | 'expanded';
    currentWordIndex: number | null;
    currentTime: number;
    isPlaying: boolean;
    notes: Note[];
    highlightedWordRef: React.RefObject<HTMLSpanElement | null>;
    speakerMappings: Record<string, string>;
    autoScrollEnabled: boolean;
    onSeek: (time: number) => void;
    className?: string;
}
export const TranscriptView = forwardRef<HTMLDivElement, TranscriptViewProps>(({ transcript, livePartial, mode,
// currentWordIndex, 
currentTime, isPlaying, 
// notes, 
// highlightedWordRef,
speakerMappings, autoScrollEnabled, onSeek, className }, ref) => {
    const displayTranscript = useMemo(() => transcript ? prepareTranscriptForDisplay(transcript) : null, [transcript]);
    const speakerOrder = useMemo(() => {
        const ordered = new Map<string, number>();
        for (const word of transcript?.word_segments || []) {
            if (word.speaker && !ordered.has(word.speaker))
                ordered.set(word.speaker, ordered.size + 1);
        }
        for (const segment of transcript?.segments || []) {
            if (segment.speaker && !ordered.has(segment.speaker))
                ordered.set(segment.speaker, ordered.size + 1);
        }
        return ordered;
    }, [transcript]);
    const getDisplaySpeakerName = (originalSpeaker: string): string => speakerMappings[originalSpeaker] || (originalSpeaker.startsWith('topic') ? originalSpeaker : (translateUI("\u8BF4\u8BDD\u4EBA ") + (speakerOrder.get(originalSpeaker) || originalSpeaker) + ""));
    const containerRef = useRef<HTMLDivElement>(null);
    const [isModifierPressed, setIsModifierPressed] = useState(false);
    const isDesktop = useIsDesktop();
    // Use CSS Highlight API for Compact Mode
    // Note: We only use this hook when in compact mode to save resources
    const words = displayTranscript?.word_segments || [];
    const { fullText, offsets } = useKaraokeHighlight(containerRef, words, currentTime, isPlaying);
    const compactSelectionMap = useMemo(() => JSON.stringify(offsets.map((offset, wordIndex) => ({
        startChar: offset.startChar,
        endChar: offset.endChar,
        startTime: offset.startTime,
        endTime: offset.endTime,
        wordIndex,
    }))), [offsets]);
    // Click-to-Seek Handler
    const handleWordClick = useCallback((e: React.MouseEvent) => {
        // Only trigger if Cmd (Mac) or Ctrl (Windows) is held
        if (!e.metaKey && !e.ctrlKey)
            return;
        if ((e.target as Element).closest('[data-transcript-draft]')) return;
        const clickOffset = getCaretOffsetFromPoint(e.clientX, e.clientY);
        if (clickOffset === null)
            return;
        const clickedWord = offsets.find(w => clickOffset >= w.startChar && clickOffset <= w.endChar);
        if (clickedWord) {
            onSeek(clickedWord.startTime);
            e.preventDefault();
        }
    }, [offsets, onSeek]);
    // Keyboard listener for modifier key visual cue
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Meta' || e.key === 'Control')
                setIsModifierPressed(true);
        };
        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.key === 'Meta' || e.key === 'Control')
                setIsModifierPressed(false);
        };
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, []);
    // Expanded View Logic
    const segmentRefs = useRef<(HTMLDivElement | null)[]>([]);
    const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
    // 1. Precompute per-segment text and offsets
    const expandedData = useMemo(() => {
        if (!displayTranscript?.segments)
            return [];
        // Keep sentence offsets when grouping FunASR's sentence-timestamped
        // output. The paragraph stays readable, but the highlight can follow
        // the current sentence instead of remaining on a 45-second paragraph.
        if (!displayTranscript.word_segments?.length) {
            const paragraphs: ExpandedSegment[] = [];
            for (const segment of displayTranscript.segments) {
                const text = segment.text.trim();
                if (!text)
                    continue;
                const sentenceOffset = (startChar: number) => ({
                    startChar,
                    endChar: startChar + text.length,
                    startTime: segment.start,
                    endTime: segment.end,
                    word: text,
                });
                appendReadingParagraph(paragraphs, { ...segment, text, fullText: text, offsets: [sentenceOffset(0)] });
            }
            return paragraphs;
        }
        // Assign each aligned word to exactly one segment. The old +/- 0.1 s
        // filter included boundary words in both neighbors (e.g. 那 / 那么).
        const wordsBySegment: WordSegment[][] = displayTranscript.segments.map(() => []);
        const originalWordIndices = new Map(displayTranscript.word_segments.map((word, index) => [word, index]));
        let segmentIndex = 0;
        for (const word of displayTranscript.word_segments) {
            while (segmentIndex + 1 < displayTranscript.segments.length &&
                word.start >= displayTranscript.segments[segmentIndex + 1].start) {
                segmentIndex++;
            }
            wordsBySegment[segmentIndex].push(word);
        }
        const paragraphs: ExpandedSegment[] = [];
        displayTranscript.segments.forEach((segment, index) => {
            const segmentWords = wordsBySegment[index];
            if (segmentWords.length === 0) {
                appendReadingParagraph(paragraphs, { ...segment, fullText: segment.text, offsets: [{
                    startChar:0, endChar:segment.text.length, startTime:segment.start,
                    endTime:segment.end, word:segment.text,
                }] });
                return;
            }
            // An ASR segment may contain several speakers. Split it at word-level
            // speaker changes so the timeline shows the actual turn boundaries.
            const runs: Array<{
                speaker?: string;
                words: WordSegment[];
            }> = [];
            for (const word of segmentWords) {
                const speaker = displayTranscript.realtime ? (word.speaker ?? undefined) : (word.speaker || runs[runs.length - 1]?.speaker || segment.speaker);
                const lastRun = runs[runs.length - 1];
                if (!lastRun || lastRun.speaker !== speaker) {
                    runs.push({ speaker, words: [word] });
                }
                else {
                    lastRun.words.push(word);
                }
            }
            runs.forEach((run) => splitDisplayWordsIntoSentences(run.words).forEach((sentenceWords) => {
                const { fullText, offsets: localOffsets } = computeWordOffsets(sentenceWords);
                const offsets = localOffsets.map((offset, wordIndex) => ({
                    ...offset,
                    wordIndex: originalWordIndices.get(sentenceWords[wordIndex]) ?? -1,
                }));
                const part: ExpandedSegment = {
                    ...segment,
                    start: sentenceWords[0].start,
                    end: sentenceWords[sentenceWords.length - 1].end,
                    speaker: run.speaker,
                    fullText,
                    offsets,
                };
                appendReadingParagraph(paragraphs, part);
            }));
        });
        return paragraphs;
    }, [displayTranscript]);
    const activeSegmentIndex = useMemo(() => {
        if (mode !== 'expanded' || !expandedData.length)
            return -1;
        for (let i = expandedData.length - 1; i >= 0; i--) {
            if (currentTime >= expandedData[i].start)
                return i;
        }
        return -1;
    }, [currentTime, expandedData, mode]);
    useEffect(() => {
        if (!autoScrollEnabled || activeSegmentIndex < 0)
            return;
        const row = rowRefs.current[activeSegmentIndex];
        if (!row)
            return;
        const bounds = row.getBoundingClientRect();
        const top = 140; // Leave room for the sticky audio player.
        const bottom = window.innerHeight - 80;
        if (bounds.top < top || bounds.bottom > bottom) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [activeSegmentIndex, autoScrollEnabled]);
    // 2. Highlight Effect for Expanded View
    useEffect(() => {
        if (typeof CSS === 'undefined' || !CSS.highlights)
            return;
        if (!displayTranscript?.word_segments?.length) {
            CSS.highlights.delete('karaoke-word');
            return;
        }
        if (mode !== 'expanded' || !expandedData.length || !isPlaying)
            return;
        // Find the active segment and word
        // Optimization: We could binary search segments, but N is usually small (<1000). Linear is okay or optimize later.
        // Actually for real-time validation, let's just find the active word in the relevant segment.
        let found = false;
        // Search backwards to find the LATEST segment that has started
        // This prevents getting stuck on the first segment (which is always "started" relative to future time)
        for (let i = expandedData.length - 1; i >= 0; i--) {
            const seg = expandedData[i];
            // Optimization: If segment hasn't started yet, skip it
            // (heuristic using segment start time)
            if (seg.start > currentTime)
                continue;
            const activeIndex = findActiveWordIndex(seg.offsets, currentTime);
            if (activeIndex !== -1 && currentTime <= seg.offsets[activeIndex].endTime) {
                const w = seg.offsets[activeIndex];
                const el = segmentRefs.current[i];
                if (el && el.firstChild) {
                    try {
                        const range = new Range();
                        if (w.endChar <= (el.firstChild as Text).length) {
                            range.setStart(el.firstChild, w.startChar);
                            range.setEnd(el.firstChild, w.endChar);
                            const highlight = new Highlight(range);
                            CSS.highlights.set('karaoke-word', highlight);
                            found = true;
                        }
                    }
                    catch {
                        // Ignore range errors
                    }
                }
                if (found)
                    break;
            }
        }
        if (!found) {
            if (CSS.highlights.has('karaoke-word'))
                CSS.highlights.delete('karaoke-word');
        }
    }, [currentTime, isPlaying, mode, expandedData, displayTranscript]);
    // 3. Click Handler for Expanded View
    const handleExpandedClick = useCallback((e: React.MouseEvent, segmentIndex: number) => {
        if (!e.metaKey && !e.ctrlKey)
            return;
        if (!displayTranscript?.word_segments?.length) {
            const target = e.target as HTMLElement;
            const sentenceIndexValue = target.closest('[data-sentence-index]')?.getAttribute('data-sentence-index');
            if (sentenceIndexValue === undefined || sentenceIndexValue === null)
                return;
            const sentenceIndex = Number(sentenceIndexValue);
            const sentence = Number.isInteger(sentenceIndex) ? expandedData[segmentIndex]?.offsets[sentenceIndex] : undefined;
            if (sentence) {
                onSeek(sentence.startTime);
                e.preventDefault();
            }
            return;
        }
        if ((e.target as Element).closest('[data-transcript-draft]')) return;
        const clickOffset = getCaretOffsetFromPoint(e.clientX, e.clientY);
        if (clickOffset === null)
            return;
        const segData = expandedData[segmentIndex];
        if (!segData)
            return;
        const clickedWord = segData.offsets.find(w => clickOffset >= w.startChar && clickOffset <= w.endChar);
        if (clickedWord) {
            onSeek(clickedWord.startTime);
            e.preventDefault();
        }
    }, [expandedData, onSeek, displayTranscript]);
    if (!transcript) {
        return (<div className="flex flex-col items-center justify-center h-64 text-carbon-400">
                <p>{translateUI("No transcript available.")}</p>
            </div>);
    }
    const lastParagraph = expandedData[expandedData.length-1];
    const attachDraft = shouldAttachRealtimeDraft(lastParagraph ? {...lastParagraph,text:lastParagraph.fullText} : undefined, livePartial);
    const draftText = livePartial?.text ? <span data-transcript-draft="true" className="select-none text-muted-foreground">{` ${translateUI('Recognizing…')}${!livePartial.speaker ? ` · ${translateUI('Speaker pending')}` : ''} `}{livePartial.text}</span> : null;
    // Render transcript with word-level highlighting for compact view
    const renderCompactView = () => {
        if (!displayTranscript?.word_segments?.length) {
            return <p className="text-lg leading-relaxed text-carbon-700 dark:text-carbon-300 whitespace-pre-wrap">{displayTranscript?.text}{draftText}</p>;
        }
        return (<div ref={containerRef} data-selection-map={compactSelectionMap} onClick={isDesktop ? handleWordClick : undefined} className={cn("text-lg leading-relaxed text-carbon-700 dark:text-carbon-300 whitespace-pre-wrap font-reading selection:bg-orange-500/30 transition-colors duration-200 select-text", isDesktop && isModifierPressed ? 'cursor-pointer hover:text-carbon-900 dark:hover:text-carbon-100' : 'cursor-text')} style={{
                // CRITICAL: Enable native text selection on iOS/Android
                WebkitUserSelect: 'text',
                userSelect: 'text',
                // CRITICAL: Remove grey tap highlight on iOS
                WebkitTapHighlightColor: 'transparent',
                // CRITICAL: Allow text selection gestures while supporting scroll
                // 'manipulation' allows pan and pinch-zoom but not double-tap zoom
                touchAction: 'pan-y pinch-zoom',
                // Ensure text is the selection target, not the container
                WebkitTouchCallout: 'default'
            }}>
                {/* The hook returns the built text string, so we just render it directly */}
                {fullText}{draftText}
            </div>);
    };
    const renderExpandedView = () => {
        if (!displayTranscript?.segments?.length) {
            return renderCompactView();
        }
        return (<div className="space-y-1">
                {expandedData.map((segment, i) => {
                const isNewTurn = i === 0 || expandedData[i - 1].speaker !== segment.speaker;
                return (<div key={i} ref={(el) => { rowRefs.current[i] = el; }} data-active={i === activeSegmentIndex ? 'true' : undefined} className={cn("group flex flex-col sm:flex-row items-start gap-4 px-3 rounded-lg transition-colors border", isNewTurn ? "mt-4 py-3" : "py-1.5", i === activeSegmentIndex
                        ? "bg-[var(--brand-light)] border-[var(--brand-solid)]"
                        : "border-transparent hover:bg-carbon-50 dark:hover:bg-carbon-800/50 hover:border-carbon-100 dark:hover:border-carbon-800")}>
                        {/* Timestamp & Speaker */}
                        <div className="flex-shrink-0 w-24 sm:w-28 flex flex-col items-start sm:items-end gap-1 text-xs text-carbon-500 dark:text-carbon-400 select-none mt-1">
                            {isNewTurn && (<button type="button" onClick={() => onSeek(segment.start)} title={translateUI("\u4ECE\u8FD9\u91CC\u64AD\u653E")} className="font-mono bg-carbon-100 dark:bg-carbon-800/80 px-1.5 py-0.5 rounded text-[10px] sm:text-xs hover:text-[var(--brand-solid)] cursor-pointer">
                                    {new Date(segment.start * 1000).toISOString().substr(11, 8)}
                                </button>)}
                            {(segment.speaker || displayTranscript.realtime) && isNewTurn && (<span className="font-medium text-carbon-700 dark:text-carbon-300 truncate max-w-full" title={segment.speaker ? getDisplaySpeakerName(segment.speaker) : translateUI('Speaker pending')}>
                                    {segment.speaker ? getDisplaySpeakerName(segment.speaker) : translateUI('Speaker pending')}
                                </span>)}
                        </div>

                        {/* Text */}
                        <div ref={(el) => { segmentRefs.current[i] = el; }} data-selection-map={displayTranscript.word_segments?.length ? JSON.stringify(segment.offsets) : undefined} onClick={isDesktop ? (e) => handleExpandedClick(e, i) : undefined} className={cn("flex-grow text-base text-primary leading-relaxed whitespace-pre-wrap font-reading transition-colors duration-200 select-text", isDesktop && isModifierPressed ? 'cursor-pointer hover:text-carbon-900 dark:hover:text-carbon-100' : 'cursor-text')} style={{
                        // CRITICAL: Enable native text selection on iOS/Android
                        WebkitUserSelect: 'text',
                        userSelect: 'text',
                        // CRITICAL: Remove grey tap highlight on iOS
                        WebkitTapHighlightColor: 'transparent',
                        // CRITICAL: Allow text selection gestures while supporting scroll
                        touchAction: 'pan-y pinch-zoom',
                        WebkitTouchCallout: 'default'
                    }}>
                            {!displayTranscript.word_segments?.length && segment.offsets.length > 0
                        ? segment.offsets.map((sentence, sentenceIndex) => {
                            const previousEnd = sentenceIndex > 0 ? segment.offsets[sentenceIndex - 1].endChar : 0;
                            const nextStart = segment.offsets[sentenceIndex + 1]?.startTime ?? segment.end + 0.25;
                            const activeSentence = i === activeSegmentIndex &&
                                currentTime >= sentence.startTime && currentTime < nextStart;
                            return (<span key={`${sentence.startTime}-${sentenceIndex}`} data-sentence-index={sentenceIndex} data-active-sentence={activeSentence ? 'true' : undefined} className={activeSentence ? 'rounded bg-amber-200/70 dark:bg-amber-700/40' : undefined}>
                                            {segment.fullText.slice(previousEnd, sentence.endChar)}
                                        </span>);
                        })
                        : (segment.fullText || segment.text)}
                        {attachDraft && i === expandedData.length-1 && draftText}
                        </div>
                    </div>);
            })}
            </div>);
    };
    return (<div ref={ref} className={cn("w-full max-w-none font-inter mt-4", className)}>
            {mode === 'compact' ? renderCompactView() : renderExpandedView()}
            {livePartial?.text && mode !== 'compact' && displayTranscript?.segments?.length && !attachDraft && <div className="flex flex-col sm:flex-row items-start gap-4 px-3 py-3">
                <div className="flex-shrink-0 w-24 sm:w-28 flex flex-col sm:items-end gap-1 text-xs text-muted-foreground">
                    <span>{translateUI('Recognizing…')}</span>
                    <span>{livePartial.speaker ? getDisplaySpeakerName(livePartial.speaker) : translateUI('Speaker pending')}</span>
                </div>
                <p className="min-w-0 flex-1 text-base leading-relaxed whitespace-normal break-words text-muted-foreground">{livePartial.text}</p>
            </div>}

            {/* CSS for the Highlight API - Global for both views */}
            <style>{`
                ::highlight(karaoke-word) {
                    background-color: transparent;
                    color: var(--brand-solid) !important;
                    font-weight: 600;
                    text-decoration: underline decoration-dotted var(--brand-solid);
                    text-underline-offset: 4px;
                }
            `}</style>
        </div>);
});
TranscriptView.displayName = 'TranscriptView';
