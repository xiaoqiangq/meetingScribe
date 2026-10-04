import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAudioUpload } from '../hooks/useAudioFiles';
import { isAudioFile, isVideoFile } from '@/utils/fileProcessor';
import { parseTopicTimes, formatTopicTime } from '@/components/transcription/topicTimes';

export function LongAudioUploadDialog({ open, onOpenChange }: {open: boolean; onOpenChange: (value: boolean) => void}) {
  const selection = useRef(0);
  const [file, setFile] = useState<File>();
  const [times, setTimes] = useState('');
  const [duration, setDuration] = useState<number>();
  const [error, setError] = useState('');
  const { mutateAsync: upload, isPending } = useAudioUpload();
  const chooseFile = async (selected?: File) => {
    const currentSelection = ++selection.current;
    setFile(selected); setDuration(undefined); setError('');
    if (!selected) return;
    if (!isAudioFile(selected) && !isVideoFile(selected)) { setError('请选择音频或视频文件'); return; }
    const url = URL.createObjectURL(selected);
    const media = document.createElement('audio');
    media.onloadedmetadata = () => { if (currentSelection === selection.current) setDuration(media.duration); URL.revokeObjectURL(url); };
    media.onerror = () => { URL.revokeObjectURL(url); };
    media.src = url;
  };
  const submit = async () => {
    try {
      if (!file) throw new Error('请选择文件');
      if (!isAudioFile(file) && !isVideoFile(file)) throw new Error('请选择音频或视频文件');
      const points = parseTopicTimes(times);
      if (duration && points.some(p => p >= duration)) throw new Error('分界时间必须在音频结束之前');
      setError('');
      await upload({ file, isVideo: isVideoFile(file), topicBoundaries: points });
      setFile(undefined); setTimes(''); setDuration(undefined); onOpenChange(false);
    } catch (err) { setError(err instanceof Error ? err.message : '上传失败'); }
  };
  let preview: number[] = [];
  try { preview = parseTopicTimes(times); } catch { /* Validation is shown on submit. */ }
  return <Dialog open={open} onOpenChange={value => { if (!isPending) onOpenChange(value); }}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>上传长音频</DialogTitle><DialogDescription>按话题分别识别人，完成后试听并确认姓名及跨话题人物联系。也支持视频提取音频。</DialogDescription></DialogHeader>
      <div className="space-y-4">
        <Label htmlFor="long-audio-file">音频或视频</Label>
        <Input id="long-audio-file" type="file" accept="audio/*,video/*,.wav,.flac,.mp3,.m4a" disabled={isPending} onChange={event => void chooseFile(event.target.files?.[0])} />
        {duration && <p className="text-sm text-muted-foreground">时长：{formatTopicTime(duration)}</p>}
        <Label htmlFor="topic-cuts">Topic 分界时间</Label>
        <Input id="topic-cuts" value={times} disabled={isPending} onChange={e => setTimes(e.target.value)} placeholder="例如 43:00；多个时间用逗号分隔" />
        <p className="text-sm text-muted-foreground">使用 MM:SS 或 HH:MM:SS。上传后可在转写参数中修改。</p>
        {preview.length > 0 && <ol className="text-sm space-y-1">{[0, ...preview].map((start, i) => <li key={start}>Topic {i + 1}：{formatTopicTime(start)} — {preview[i] ? formatTopicTime(preview[i]) : duration ? formatTopicTime(duration) : '结束'}</li>)}</ol>}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <Button disabled={!file || isPending} onClick={() => void submit()}>{isPending ? '上传中…' : '上传并保存分界点'}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
