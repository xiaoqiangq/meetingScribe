import OpenCC from "opencc-js/t2cn";
import type { Transcript, WordSegment } from "./useAudioDetail";
const toSimplifiedChinese = OpenCC.Converter({ from: "t", to: "cn" });

export function normalizeTranscriptResponse(data: any): Transcript | null {
    // Handle graceful empty responses (available=false)
    if (!data || data.available === false || !data.transcript) {
        return null; // Return null to indicate no transcript
    }

    // Normalize transcript structure
    if (typeof data.transcript === "string") {
        return { text: toSimplifiedChinese(data.transcript) } as Transcript;
    } else if (data.transcript.text) {
        return {
            ...(data.transcript.metadata?.mode === "realtime" ? {realtime:true} : {}),
            text: toSimplifiedChinese(data.transcript.text),
            segments: data.transcript.segments?.map((segment: NonNullable<Transcript["segments"]>[number]) => ({
        ...segment,
        text: toSimplifiedChinese(segment.text),
            })),
            word_segments: data.transcript.word_segments?.map((word: WordSegment) => ({
        ...word,
        word: toSimplifiedChinese(word.word),
            })),
        } as Transcript;
    } else if (data.transcript.segments) {
        const fullText = data.transcript.segments
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((segment: any) => segment.text)
            .join(" ");
        return {
            ...(data.transcript.metadata?.mode === "realtime" ? {realtime:true} : {}),
            text: toSimplifiedChinese(fullText),
            segments: data.transcript.segments.map((segment: NonNullable<Transcript["segments"]>[number]) => ({
        ...segment,
        text: toSimplifiedChinese(segment.text),
            })),
            word_segments: data.transcript.word_segments?.map((word: WordSegment) => ({
        ...word,
        word: toSimplifiedChinese(word.word),
            })),
        } as Transcript;
    }

    return { text: "" } as Transcript;
}
