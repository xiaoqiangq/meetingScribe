import { useInterfaceLanguage } from '@/i18n';
import { t as translateUI } from "@/i18n";
import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAudioUpload } from '../hooks/useAudioFiles';
import { isAudioFile, isVideoFile } from '@/utils/fileProcessor';
import { parseTopicTimes, formatTopicTime } from '@/components/transcription/topicTimes';
export function LongAudioUploadDialog({ open, onOpenChange }: {
    open: boolean;
    onOpenChange: (value: boolean) => void;
}) {
    useInterfaceLanguage();
    const selection = useRef(0);
    const [file, setFile] = useState<File>();
    const [times, setTimes] = useState('');
    const [duration, setDuration] = useState<number>();
    const [error, setError] = useState('');
    const { mutateAsync: upload, isPending } = useAudioUpload();
    const chooseFile = async (selected?: File) => {
        const currentSelection = ++selection.current;
        setFile(selected);
        setDuration(undefined);
        setError('');
        if (!selected)
            return;
        if (!isAudioFile(selected) && !isVideoFile(selected)) {
            setError(translateUI("\u8BF7\u9009\u62E9\u97F3\u9891\u6216\u89C6\u9891\u6587\u4EF6"));
            return;
        }
        const url = URL.createObjectURL(selected);
        const media = document.createElement('audio');
        media.onloadedmetadata = () => {
            if (currentSelection === selection.current)
                setDuration(media.duration);
            URL.revokeObjectURL(url);
        };
        media.onerror = () => { URL.revokeObjectURL(url); };
        media.src = url;
    };
    const submit = async () => {
        try {
            if (!file)
                throw new Error(translateUI("\u8BF7\u9009\u62E9\u6587\u4EF6"));
            if (!isAudioFile(file) && !isVideoFile(file))
                throw new Error(translateUI("\u8BF7\u9009\u62E9\u97F3\u9891\u6216\u89C6\u9891\u6587\u4EF6"));
            const points = parseTopicTimes(times);
            if (duration && points.some(p => p >= duration))
                throw new Error(translateUI("\u5206\u754C\u65F6\u95F4\u5FC5\u987B\u5728\u97F3\u9891\u7ED3\u675F\u4E4B\u524D"));
            setError('');
            await upload({ file, isVideo: isVideoFile(file), topicBoundaries: points });
            setFile(undefined);
            setTimes('');
            setDuration(undefined);
            onOpenChange(false);
        }
        catch (err) {
            setError(err instanceof Error ? translateUI(err.message) : translateUI("\u4E0A\u4F20\u5931\u8D25"));
        }
    };
    let preview: number[] = [];
    try {
        preview = parseTopicTimes(times);
    }
    catch { /* Validation is shown on submit. */ }
    return <Dialog open={open} onOpenChange={value => {
            if (!isPending)
                onOpenChange(value);
        }}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>{translateUI("\u4E0A\u4F20\u957F\u97F3\u9891")}</DialogTitle><DialogDescription>{translateUI("\u6309\u8BDD\u9898\u5206\u522B\u8BC6\u522B\u4EBA\uFF0C\u5B8C\u6210\u540E\u8BD5\u542C\u5E76\u786E\u8BA4\u59D3\u540D\u53CA\u8DE8\u8BDD\u9898\u4EBA\u7269\u8054\u7CFB\u3002\u4E5F\u652F\u6301\u89C6\u9891\u63D0\u53D6\u97F3\u9891\u3002")}</DialogDescription></DialogHeader>
      <div className="space-y-4">
        <Label htmlFor="long-audio-file">{translateUI("\u97F3\u9891\u6216\u89C6\u9891")}</Label>
        <Input id="long-audio-file" type="file" accept="audio/*,video/*,.wav,.flac,.mp3,.m4a" disabled={isPending} onChange={event => void chooseFile(event.target.files?.[0])}/>
        {duration && <p className="text-sm text-muted-foreground">{translateUI("\u65F6\u957F\uFF1A")}{formatTopicTime(duration)}</p>}
        <Label htmlFor="topic-cuts">{translateUI("Topic \u5206\u754C\u65F6\u95F4")}</Label>
        <Input id="topic-cuts" value={times} disabled={isPending} onChange={e => setTimes(e.target.value)} placeholder={translateUI("\u4F8B\u5982 43:00\uFF1B\u591A\u4E2A\u65F6\u95F4\u7528\u9017\u53F7\u5206\u9694")}/>
        <p className="text-sm text-muted-foreground">{translateUI("\u4F7F\u7528 MM:SS \u6216 HH:MM:SS\u3002\u4E0A\u4F20\u540E\u53EF\u5728\u8F6C\u5199\u53C2\u6570\u4E2D\u4FEE\u6539\u3002")}</p>
        {preview.length > 0 && <ol className="text-sm space-y-1">{[0, ...preview].map((start, i) => <li key={start}>{translateUI("Topic")}{i + 1}：{formatTopicTime(start)} — {preview[i] ? formatTopicTime(preview[i]) : duration ? formatTopicTime(duration) : translateUI("\u7ED3\u675F")}</li>)}</ol>}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <Button disabled={!file || isPending} onClick={() => void submit()}>{isPending ? translateUI("\u4E0A\u4F20\u4E2D\u2026") : translateUI("\u4E0A\u4F20\u5E76\u4FDD\u5B58\u5206\u754C\u70B9")}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
