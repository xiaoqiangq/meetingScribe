import { t } from '@/i18n';
import { groupRealtimeParagraphs, joinRealtimeText, type RealtimeDisplaySegment } from './transcriptDisplay';

const clock = (value: number) => `${Math.floor(value / 60).toString().padStart(2, '0')}:${Math.floor(value % 60).toString().padStart(2, '0')}`;
const speakerName = (speaker?: string | null) => speaker ? `${t('Speaker')} ${Number(speaker.split('_')[1]) + 1}` : t('Speaker pending');

export function LiveTranscriptView({ segments, partial }: {
    segments: RealtimeDisplaySegment[];
    partial?: RealtimeDisplaySegment | null;
}) {
    const paragraphs = groupRealtimeParagraphs(segments, partial);
    return <div className="space-y-1" aria-live="polite">
        {paragraphs.map((paragraph, index) => <article key={`${paragraph.start}-${index}`} className="flex flex-col sm:flex-row gap-2 sm:gap-5 py-4 border-b border-[var(--border-subtle)] last:border-b-0">
            <div className="sm:w-32 sm:shrink-0 flex sm:flex-col items-baseline gap-2 text-sm">
                <strong className="text-orange-600">{speakerName(paragraph.speaker)}</strong>
                <span className="text-xs tabular-nums text-muted-foreground">{clock(paragraph.start)} – {clock(paragraph.end)}</span>
                {paragraph.draft && <span className="text-xs text-muted-foreground">{t('Recognizing…')}</span>}
            </div>
            <p className="min-w-0 flex-1 text-base leading-relaxed font-reading whitespace-normal break-words">
                {paragraph.text}
                {paragraph.draft && <span className="text-muted-foreground" data-draft="true">{joinRealtimeText(paragraph.text, paragraph.draft).slice(paragraph.text.length)}</span>}
            </p>
        </article>)}
    </div>;
}
