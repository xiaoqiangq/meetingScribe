import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MainLayout } from '@/components/layout/MainLayout';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { Users, Upload, Loader2 } from 'lucide-react';

interface Sample { file: string; start: number; end: number; created_at?: string }
interface Person { id: string; name: string; samples: Sample[]; duration_seconds: number }
interface Job { id: string; name: string; status: 'processing' | 'ready' | 'failed'; created_at: string; error?: string }
interface Library { people: Person[]; jobs: Job[]; model: string; notice: string }

export function VoiceprintLibrary() {
  const { getAuthHeaders } = useAuth();
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const { data, error, isLoading } = useQuery<Library>({
    queryKey: ['nativeVoiceprintLibrary'],
    queryFn: async () => {
      const res = await fetch('/api/v1/voiceprints/', {headers: getAuthHeaders()});
      if (!res.ok) throw new Error('无法读取声纹库，请稍后重试。');
      return res.json();
    },
    refetchInterval: query => query.state.data?.jobs.some(job => job.status === 'processing') ? 2500 : false,
  });
  const processing = data?.jobs.some(job => job.status === 'processing');
  async function upload() {
    if (!file || !name.trim() || !confirmed) return;
    if (file.size > 30 * 1024 * 1024) { setMessage('文件不能超过 30 MB。'); return; }
    setUploading(true); setMessage('');
    try {
      const body = new FormData(); body.append('audio', file); body.append('name', name.trim()); body.append('single_speaker', 'true');
      const res = await fetch('/api/v1/voiceprints/', {method: 'POST', headers: getAuthHeaders(), body});
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || '上传失败，请重试。');
      setMessage('录音已上传，正在使用 Nemotron 提取声纹。');
      await client.invalidateQueries({queryKey: ['nativeVoiceprintLibrary']});
    } catch (err) { setMessage(err instanceof Error ? err.message : '上传失败'); }
    finally { setUploading(false); }
  }
  return <MainLayout header={<Header />}>
    <div className="mt-8 space-y-6 text-[var(--text-primary)]">
      <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-6 shadow-sm">
        <h1 className="flex items-center gap-2 text-2xl font-bold"><Users className="h-6 w-6 text-[var(--brand-solid)]" />声纹库</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">上传一个人的清晰录音，填写姓名，使用 Nemotron-3 自身提取特征。已有同名人物时追加样本。</p>
        <p className="mt-2 text-xs text-[var(--text-tertiary)]">声纹和录音在本服务器保存、处理。原生特征方案仍为试验，姓名匹配只给推荐，需你确认。</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="space-y-2 text-sm">姓名
            <input aria-label="声纹姓名" list="voiceprint-names" value={name} onChange={event => setName(event.target.value)} maxLength={50} placeholder="例如：张三" className="block w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2" />
            <datalist id="voiceprint-names">{data?.people.map(person => <option key={person.name} value={person.name} />)}</datalist>
          </label>
          <label className="space-y-2 text-sm">单人录音
            <input aria-label="声纹录音" type="file" accept="audio/*,.wav,.mp3,.m4a,.flac,.ogg,.aac" onChange={event => {setFile(event.target.files?.[0] || null); setMessage('');}} className="block w-full rounded-lg border border-[var(--border-subtle)] px-3 py-2" />
          </label>
        </div>
        <p className="mt-3 text-sm text-[var(--text-secondary)]">10–180 秒，建议 20–60 秒；最多 30 MB。只保留该人的讲话，剪掉长静音，避免背景音乐和多人重叠。</p>
        <label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1" />我确认录音中只有上述人物在说话，并可以将此录音用于声纹库。</label>
        <Button onClick={upload} disabled={uploading || processing || !file || !name.trim() || !confirmed} className="mt-4 gap-2">{uploading || processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}{processing ? '正在提取…' : '上传并生成声纹'}</Button>
        {message && <p role="status" className="mt-3 text-sm">{message}</p>}
      </section>
      {isLoading && <p>正在读取声纹库…</p>}
      {error && <p role="alert">{error.message}</p>}
      {data && <>
        <h2 className="text-lg font-semibold">已登记人物 · {data.people.length} 人</h2>
        <div className="grid gap-4 lg:grid-cols-3">{data.people.map(person => <section key={person.name} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
          <h3 className="text-lg font-semibold">{person.name}</h3>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">{person.samples.length} 个参考片段 · 共 {person.duration_seconds.toFixed(1)} 秒</p>
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">Nemotron-3 原生特征</p>
          <div className="mt-4 space-y-3">{person.samples.map((sample, index) => <div key={sample.file}>
            <p className="mb-1 text-xs text-[var(--text-secondary)]">样本 {index + 1} · {(sample.end - sample.start).toFixed(1)} 秒</p>
            <audio aria-label={`${person.name}样本${index + 1}`} controls preload="none" src={`/api/v1/voiceprints/samples/${encodeURIComponent(sample.file)}`} className="h-9 w-full" />
          </div>)}</div>
          <Button variant="outline" className="mt-4" onClick={() => {setName(person.name); setConfirmed(false); window.scrollTo({top: 0, behavior: 'smooth'});}}>为此人追加录音</Button>
        </section>)}</div>
        {data.jobs.length > 0 && <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
          <h2 className="text-lg font-semibold">提取记录</h2>
          {[...data.jobs].sort((a,b) => b.created_at.localeCompare(a.created_at)).map(job => <div key={job.id} className="mt-3 border-t border-[var(--border-subtle)] pt-3 text-sm">
            <p>{job.name} · {job.status === 'ready' ? '已生成并入库' : job.status === 'failed' ? '提取失败' : 'Nemotron 正在提取'}</p>
            <p className="text-xs text-[var(--text-secondary)]">{new Date(job.created_at).toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai', hour12: false})}</p>
            {job.error && <p className="mt-1 text-[var(--error)]">{job.error}</p>}
          </div>)}
        </section>}
        <p className="pb-6 text-xs text-[var(--text-secondary)]">{data.notice}</p>
      </>}
    </div>
  </MainLayout>;
}
