import { useInterfaceLanguage } from '@/i18n';
import { t as translateUI } from "@/i18n";
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useGlobalUpload } from '@/contexts/GlobalUploadContext';
import { isAudioFile, isVideoFile } from '@/utils/fileProcessor';
import { validateTopicTimes, formatTopicTime } from '@/components/transcription/topicTimes';
export function LongAudioUploadDialog({ open, onOpenChange }: {
    open: boolean;
    onOpenChange: (value: boolean) => void;
}) {
    useInterfaceLanguage();
    const [file, setFile] = useState<File>();
    const [times, setTimes] = useState('');
    const [duration, setDuration] = useState<number>();
    const [metadataStatus, setMetadataStatus] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');
    const [error, setError] = useState('');
    const { startLongUpload } = useGlobalUpload();
    const isPending = false;
    const validFile = !!file && (isAudioFile(file) || isVideoFile(file));
    useEffect(() => {
        setDuration(undefined);
        if (!file || !validFile) {
            setMetadataStatus('idle');
            return;
        }
        setMetadataStatus('loading');
        let cancelled = false;
        const url = URL.createObjectURL(file);
        const media = document.createElement(isVideoFile(file) ? 'video' : 'audio');
        const finish = () => {
            if (cancelled) return;
            cancelled = true;
            clearTimeout(timeout);
            const known = Number.isFinite(media.duration) && media.duration > 0;
            setDuration(known ? media.duration : undefined);
            setMetadataStatus(known ? 'ready' : 'unavailable');
            URL.revokeObjectURL(url);
        };
        const timeout = setTimeout(finish, 10000);
        media.onloadedmetadata = finish;
        media.onerror = finish;
        media.preload = 'metadata';
        media.src = url;
        return () => {
            cancelled = true;
            clearTimeout(timeout);
            media.onloadedmetadata = null;
            media.onerror = null;
            media.removeAttribute('src');
            media.load();
            URL.revokeObjectURL(url);
        };
    }, [file, validFile]);
    const validation = validateTopicTimes(times, duration);
    const outside = validation.outside;
    const validationError = outside
        ? translateUI('第 {index} 个分界点 {point} 必须早于文件时长 {duration}，请修改。')
            .replace('{index}', String(outside.index)).replace('{point}', formatTopicTime(outside.point)).replace('{duration}', formatTopicTime(outside.duration))
        : validation.error ? translateUI(validation.error) : '';
    const preview = validation.points;
    const submit = async () => {
        try {
            if (!file)
                throw new Error(translateUI("\u8BF7\u9009\u62E9\u6587\u4EF6"));
            if (!isAudioFile(file) && !isVideoFile(file))
                throw new Error(translateUI("\u8BF7\u9009\u62E9\u97F3\u9891\u6216\u89C6\u9891\u6587\u4EF6"));
            if (metadataStatus === 'loading') return;
            if (validationError) throw new Error(validationError);
            const points = validation.points;
            setError('');
            startLongUpload(file, isVideoFile(file), points);
            setFile(undefined);
            setTimes('');
            setDuration(undefined);
            onOpenChange(false);
        }
        catch (err) {
            setError(err instanceof Error ? translateUI(err.message) : translateUI("\u4E0A\u4F20\u5931\u8D25"));
        }
    };
    return <Dialog open={open} onOpenChange={value => {
            if (!isPending)
                onOpenChange(value);
        }}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>{translateUI("\u4E0A\u4F20\u957F\u97F3\u9891")}</DialogTitle><DialogDescription>{translateUI("\u6309\u8BDD\u9898\u5206\u522B\u8BC6\u522B\u4EBA\uFF0C\u5B8C\u6210\u540E\u8BD5\u542C\u5E76\u786E\u8BA4\u59D3\u540D\u53CA\u8DE8\u8BDD\u9898\u4EBA\u7269\u8054\u7CFB\u3002\u4E5F\u652F\u6301\u89C6\u9891\u63D0\u53D6\u97F3\u9891\u3002")}</DialogDescription></DialogHeader>
      <div className="space-y-4">
        <Label htmlFor="long-audio-file">{translateUI("\u97F3\u9891\u6216\u89C6\u9891")}</Label>
        <Input id="long-audio-file" type="file" accept="audio/*,video/*,.wav,.flac,.mp3,.m4a" disabled={isPending} onChange={event => { setFile(event.target.files?.[0]); setDuration(undefined); setMetadataStatus('loading'); setError(''); }}/>
        {metadataStatus === 'loading' && <p role="status" className="text-sm text-muted-foreground">{translateUI('正在读取文件时长…')}</p>}
        {metadataStatus === 'unavailable' && <p role="status" className="text-sm text-muted-foreground">{translateUI('无法读取文件时长；上传后后台会在转写时再次校验分界点。')}</p>}
        {file && !validFile && <p role="alert" className="text-sm text-red-600">{translateUI('请选择音频或视频文件')}</p>}
        {duration && <p className="text-sm text-muted-foreground">{translateUI("\u65F6\u957F\uFF1A")}{formatTopicTime(duration)}</p>}
        <Label htmlFor="topic-cuts">{translateUI("Topic \u5206\u754C\u65F6\u95F4")}</Label>
        <Input id="topic-cuts" value={times} disabled={isPending} onChange={e => { setTimes(e.target.value); setError(''); }} aria-invalid={!!validationError && !!times.trim()} aria-describedby="topic-validation-error" placeholder={translateUI("\u4F8B\u5982 43:00\uFF1B\u591A\u4E2A\u65F6\u95F4\u7528\u9017\u53F7\u5206\u9694")}/>
        <p className="text-sm text-muted-foreground">{translateUI("\u4F7F\u7528 MM:SS \u6216 HH:MM:SS\u3002\u4E0A\u4F20\u540E\u53EF\u5728\u8F6C\u5199\u53C2\u6570\u4E2D\u4FEE\u6539\u3002")}</p>
        {preview.length > 0 && <ol className="text-sm space-y-1">{[0, ...preview].map((start, i) => <li key={start}>{translateUI("Topic")}{i + 1}：{formatTopicTime(start)} — {preview[i] ? formatTopicTime(preview[i]) : duration ? formatTopicTime(duration) : translateUI("\u7ED3\u675F")}</li>)}</ol>}
        {((times.trim() && validationError) || error) && <p id="topic-validation-error" role="alert" className="text-sm text-red-600">{validationError || error}</p>}
        <Button disabled={!validFile || isPending || metadataStatus === 'loading' || !!validationError} onClick={() => void submit()}>{isPending ? translateUI("\u4E0A\u4F20\u4E2D\u2026") : translateUI("\u4E0A\u4F20\u5E76\u4FDD\u5B58\u5206\u754C\u70B9")}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
