import { t as translateUI } from "@/i18n";
import { getLocale } from "@/i18n";
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MainLayout } from '@/components/layout/MainLayout';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { Users, Upload, Loader2 } from 'lucide-react';
interface Sample {
    file: string;
    start: number;
    end: number;
    created_at?: string;
}
interface Person {
    id: string;
    name: string;
    samples: Sample[];
    duration_seconds: number;
}
interface Job {
    id: string;
    name: string;
    status: 'processing' | 'ready' | 'failed';
    created_at: string;
    error?: string;
}
interface Library {
    people: Person[];
    jobs: Job[];
    model: string;
    notice: string;
}
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
            const res = await fetch('/api/v1/voiceprints/', { headers: getAuthHeaders() });
            if (!res.ok)
                throw new Error(translateUI("\u65E0\u6CD5\u8BFB\u53D6\u58F0\u7EB9\u5E93\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002"));
            return res.json();
        },
        refetchInterval: query => query.state.data?.jobs.some(job => job.status === 'processing') ? 2500 : false,
    });
    const processing = data?.jobs.some(job => job.status === 'processing');
    async function upload() {
        if (!file || !name.trim() || !confirmed)
            return;
        if (file.size > 30 * 1024 * 1024) {
            setMessage(translateUI("\u6587\u4EF6\u4E0D\u80FD\u8D85\u8FC7 30 MB\u3002"));
            return;
        }
        setUploading(true);
        setMessage('');
        try {
            const body = new FormData();
            body.append('audio', file);
            body.append('name', name.trim());
            body.append('single_speaker', 'true');
            const res = await fetch('/api/v1/voiceprints/', { method: 'POST', headers: getAuthHeaders(), body });
            const result = await res.json();
            if (!res.ok)
                throw new Error(result.error || translateUI("\u4E0A\u4F20\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002"));
            setMessage(translateUI("\u5F55\u97F3\u5DF2\u4E0A\u4F20\uFF0C\u6B63\u5728\u4F7F\u7528 Nemotron \u63D0\u53D6\u58F0\u7EB9\u3002"));
            await client.invalidateQueries({ queryKey: ['nativeVoiceprintLibrary'] });
        }
        catch (err) {
            setMessage(err instanceof Error ? translateUI(err.message) : translateUI("\u4E0A\u4F20\u5931\u8D25"));
        }
        finally {
            setUploading(false);
        }
    }
    return <MainLayout header={<Header />}>
    <div className="mt-8 space-y-6 text-[var(--text-primary)]">
      <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-6 shadow-sm">
        <h1 className="flex items-center gap-2 text-2xl font-bold"><Users className="h-6 w-6 text-[var(--brand-solid)]"/>{translateUI("\u58F0\u7EB9\u5E93")}</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">{translateUI("\u4E0A\u4F20\u4E00\u4E2A\u4EBA\u7684\u6E05\u6670\u5F55\u97F3\uFF0C\u586B\u5199\u59D3\u540D\uFF0C\u4F7F\u7528 Nemotron-3 \u81EA\u8EAB\u63D0\u53D6\u7279\u5F81\u3002\u5DF2\u6709\u540C\u540D\u4EBA\u7269\u65F6\u8FFD\u52A0\u6837\u672C\u3002")}</p>
        <p className="mt-2 text-xs text-[var(--text-tertiary)]">{translateUI("\u58F0\u7EB9\u548C\u5F55\u97F3\u5728\u672C\u670D\u52A1\u5668\u4FDD\u5B58\u3001\u5904\u7406\u3002\u539F\u751F\u7279\u5F81\u65B9\u6848\u4ECD\u4E3A\u8BD5\u9A8C\uFF0C\u59D3\u540D\u5339\u914D\u53EA\u7ED9\u63A8\u8350\uFF0C\u9700\u4F60\u786E\u8BA4\u3002")}</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="space-y-2 text-sm">{translateUI("\u59D3\u540D")}<input aria-label={translateUI("\u58F0\u7EB9\u59D3\u540D")} list="voiceprint-names" value={name} onChange={event => setName(event.target.value)} maxLength={50} placeholder={translateUI("\u4F8B\u5982\uFF1A\u5F20\u4E09")} className="block w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2"/>
            <datalist id="voiceprint-names">{data?.people.map(person => <option key={person.name} value={person.name}/>)}</datalist>
          </label>
          <label className="space-y-2 text-sm">{translateUI("\u5355\u4EBA\u5F55\u97F3")}<input aria-label={translateUI("\u58F0\u7EB9\u5F55\u97F3")} type="file" accept="audio/*,.wav,.mp3,.m4a,.flac,.ogg,.aac" onChange={event => { setFile(event.target.files?.[0] || null); setMessage(''); }} className="block w-full rounded-lg border border-[var(--border-subtle)] px-3 py-2"/>
          </label>
        </div>
        <p className="mt-3 text-sm text-[var(--text-secondary)]">{translateUI("10\u2013180 \u79D2\uFF0C\u5EFA\u8BAE 20\u201360 \u79D2\uFF1B\u6700\u591A 30 MB\u3002\u53EA\u4FDD\u7559\u8BE5\u4EBA\u7684\u8BB2\u8BDD\uFF0C\u526A\u6389\u957F\u9759\u97F3\uFF0C\u907F\u514D\u80CC\u666F\u97F3\u4E50\u548C\u591A\u4EBA\u91CD\u53E0\u3002")}</p>
        <label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1"/>{translateUI("\u6211\u786E\u8BA4\u5F55\u97F3\u4E2D\u53EA\u6709\u4E0A\u8FF0\u4EBA\u7269\u5728\u8BF4\u8BDD\uFF0C\u5E76\u53EF\u4EE5\u5C06\u6B64\u5F55\u97F3\u7528\u4E8E\u58F0\u7EB9\u5E93\u3002")}</label>
        <Button onClick={upload} disabled={uploading || processing || !file || !name.trim() || !confirmed} className="mt-4 gap-2">{uploading || processing ? <Loader2 className="h-4 w-4 animate-spin"/> : <Upload className="h-4 w-4"/>}{processing ? translateUI("\u6B63\u5728\u63D0\u53D6\u2026") : translateUI("\u4E0A\u4F20\u5E76\u751F\u6210\u58F0\u7EB9")}</Button>
        {message && <p role="status" className="mt-3 text-sm">{message}</p>}
      </section>
      {isLoading && <p>{translateUI("\u6B63\u5728\u8BFB\u53D6\u58F0\u7EB9\u5E93\u2026")}</p>}
      {error && <p role="alert">{error.message}</p>}
      {data && <>
        <h2 className="text-lg font-semibold">{translateUI("\u5DF2\u767B\u8BB0\u4EBA\u7269 \u00B7")}{data.people.length}{translateUI("\u4EBA")}</h2>
        <div className="grid gap-4 lg:grid-cols-3">{data.people.map(person => <section key={person.name} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
          <h3 className="text-lg font-semibold">{person.name}</h3>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">{person.samples.length}{translateUI("\u4E2A\u53C2\u8003\u7247\u6BB5 \u00B7 \u5171")}{person.duration_seconds.toFixed(1)}{translateUI("\u79D2")}</p>
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">{translateUI("Nemotron-3 \u539F\u751F\u7279\u5F81")}</p>
          <div className="mt-4 space-y-3">{person.samples.map((sample, index) => <div key={sample.file}>
            <p className="mb-1 text-xs text-[var(--text-secondary)]">{translateUI("\u6837\u672C")}{index + 1} · {(sample.end - sample.start).toFixed(1)}{translateUI("\u79D2")}</p>
            <audio aria-label={("" + person.name + translateUI("\u6837\u672C") + (index + 1) + "")} controls preload="none" src={`/api/v1/voiceprints/samples/${encodeURIComponent(sample.file)}`} className="h-9 w-full"/>
          </div>)}</div>
          <Button variant="outline" className="mt-4" onClick={() => { setName(person.name); setConfirmed(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>{translateUI("\u4E3A\u6B64\u4EBA\u8FFD\u52A0\u5F55\u97F3")}</Button>
        </section>)}</div>
        {data.jobs.length > 0 && <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
          <h2 className="text-lg font-semibold">{translateUI("\u63D0\u53D6\u8BB0\u5F55")}</h2>
          {[...data.jobs].sort((a, b) => b.created_at.localeCompare(a.created_at)).map(job => <div key={job.id} className="mt-3 border-t border-[var(--border-subtle)] pt-3 text-sm">
            <p>{job.name} · {job.status === 'ready' ? translateUI("\u5DF2\u751F\u6210\u5E76\u5165\u5E93") : job.status === 'failed' ? translateUI("\u63D0\u53D6\u5931\u8D25") : translateUI("Nemotron \u6B63\u5728\u63D0\u53D6")}</p>
            <p className="text-xs text-[var(--text-secondary)]">{new Date(job.created_at).toLocaleString(getLocale(), { timeZone: 'Asia/Shanghai', hour12: false })}</p>
            {job.error && <p className="mt-1 text-[var(--error)]">{job.error}</p>}
          </div>)}
        </section>}
        <p className="pb-6 text-xs text-[var(--text-secondary)]">{data.notice}</p>
      </>}
    </div>
  </MainLayout>;
}
