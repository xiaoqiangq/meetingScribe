import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { Header } from './Header';
import { TranscribeDDialog } from './TranscribeDDialog';
import type { WhisperXParams } from './TranscriptionConfigDialog';
import { AudioDetailView } from '@/features/transcription/components/AudioDetailView';
import { normalizeTranscriptResponse } from '@/features/transcription/hooks/useAudioDetail';
import { useQueryClient } from '@tanstack/react-query';
import { MainLayout } from './layout/MainLayout';
import { useInterfaceLanguage } from '@/i18n';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { t } from '@/i18n';

interface Segment { start: number; end: number; text: string; speaker?: string | null }
interface Result { finished?:boolean; revision?:number; error?:string; pending_audio_seconds?:number; metadata?:{pending_alignment?:number}; id: string; job_id?:string; saved_duration?:number; text:string; word_segments?: Array<{start:number;end:number;word:string;score:number;speaker?:string}>; sequence: number; duration: number; segments: Segment[]; partial: Segment }

export function LiveTranscriptionPage() {
  useInterfaceLanguage();
  const { getAuthHeaders } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [jobId,setJobId] = useState(new URLSearchParams(window.location.search).get('project') || '');
  const [playbackRevision,setPlaybackRevision] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'starting' | 'recording' | 'paused' | 'finishing' | 'done'>('idle');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [refineOpen,setRefineOpen] = useState(false);
  const [refineLoading,setRefineLoading] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const [available, setAvailable] = useState(false);
  const [modelState, setModelState] = useState('');
  const [blob, setBlob] = useState<Blob | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('default');
  const [activeDevice, setActiveDevice] = useState('');
  const [level, setLevel] = useState(0);
  const [inputSeconds, setInputSeconds] = useState(0);
  const [pendingChunks, setPendingChunks] = useState(0);
  const analyser = useRef<AnalyserNode | null>(null);
  const session = useRef('');
  async function refreshDevices() {
    if (!navigator.mediaDevices) return;
    setDevices((await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput'));
  }
  const stream = useRef<MediaStream | null>(null);
  const context = useRef<AudioContext | null>(null);
  const node = useRef<AudioWorkletNode | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const queued = useRef(0);
  const sequence = useRef(0);
  const failure = useRef(false);
  const mounted = useRef(true);

  async function request(path: string, init: RequestInit = {}) {
    const response = await fetch(`/api/v1/realtime${path}`, { ...init, signal: AbortSignal.timeout(path.startsWith('/sessions?') ? 610000 : 65000), headers: { ...getAuthHeaders(), ...init.headers } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || data.detail || t('Realtime request failed'));
    return data;
  }

  function acceptResult(data: Result) {
    setResult(previous => previous?.id === data.id && (previous.revision || 0) > (data.revision || 0)
      ? previous : data);
  }

  useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        const response = await fetch('/client-version.json', {cache:'no-store', signal:AbortSignal.timeout(5000)});
        if (!response.ok) return;
        const data = await response.json();
        if (!stopped && data.version && import.meta.env.VITE_MEETINGSCRIBE_BUILD_ID) {
          setOutdated(data.version !== import.meta.env.VITE_MEETINGSCRIBE_BUILD_ID);
        }
      } catch { /* A version check failure must not interrupt recording. */ }
    };
    void check();
    const timer = window.setInterval(() => void check(), 15000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, []);

  // Audio acknowledgements no longer wait for inference. Poll even while paused
  // so alignment and speaker revisions can arrive without another audio packet.
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'paused') return;
    let stopped = false, inFlight = false;
    const timer = window.setInterval(async () => {
      if (stopped || inFlight || failure.current) return;
      inFlight = true;
      try {
        const data = await request(`/sessions/${session.current}/result`, {method:'POST'});
        if (data.error) throw new Error(data.error);
        if (!stopped) acceptResult(data);
      } catch (err) {
        if (!stopped) {
          failure.current = true;
          setError(err instanceof Error ? err.message : String(err));
          void stopRecording().then(() => setPhase('done'));
        }
      } finally { inFlight = false; }
    }, 1000);
    return () => { stopped = true; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  function stopTracks() {
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    analyser.current = null;
    if (mounted.current) setLevel(0);
    node.current?.disconnect();
    node.current = null;
    if (context.current) void context.current.close();
    context.current = null;
  }

  async function stopRecording() {
    const active = recorder.current;
    if (active && active.state !== 'inactive') {
      await new Promise<void>(resolve => { active.onstop = () => resolve(); active.stop(); });
    }
    const recording = new Blob(chunks.current, { type: active?.mimeType || 'audio/webm' });
    if (mounted.current) setBlob(recording);
    stopTracks();
  }

  function enqueue(pcm: ArrayBuffer) {
    if (failure.current) return;
    queued.current++;
    setPendingChunks(queued.current);
    setInputSeconds(value => value + pcm.byteLength / 32000);
    if (queued.current > 8) {
      failure.current = true;
      setError(t('Transcription is falling behind. Recording stopped; download your audio.'));
      void stopRecording().then(() => setPhase('done'));
      return;
    }
    const current = sequence.current++;
    queue.current = queue.current.then(async () => {
      if (failure.current) return;
      let last: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const data = await request(`/sessions/${session.current}/chunk?sequence=${current}`, { method: 'POST', body: pcm });
          if (data.error) throw new Error(data.error);
          if (mounted.current) acceptResult(data);
          return;
        } catch (err) { last = err; }
      }
      throw last;
    }).catch(err => {
      failure.current = true;
      if (mounted.current) {
        setError(String(err instanceof Error ? err.message : err));
        void stopRecording().then(() => setPhase('done'));
      }
    }).finally(() => { queued.current--; if (mounted.current) setPendingChunks(queued.current); });
  }

  useEffect(() => {
    setAvailable(false);
    let disposed = false;
    const checkStatus = () => {
      void request('/status').then(data => {
        if (!disposed) { setAvailable(data.available); setModelState(data.model_state || 'ready'); }
      }).catch(() => { if (!disposed) setAvailable(false); });
    };
    checkStatus();
    const statusTimer = window.setInterval(checkStatus, 5000);
    void refreshDevices().catch(() => {});
    const media = navigator.mediaDevices;
    const changed = () => { void refreshDevices().catch(() => {}); };
    media?.addEventListener("devicechange", changed);
    return () => { disposed = true; clearInterval(statusTimer); media?.removeEventListener("devicechange", changed); };
    // Opening the page never activates the microphone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      failure.current = true;
      if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
      stopTracks();
      if (session.current) void request(`/sessions/${session.current}/cancel`, { method: 'POST' }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== 'paused') return;
    const timer = window.setInterval(() => {
      void request(`/sessions/${session.current}/heartbeat`, { method: 'POST' }).catch(err => {
        failure.current = true; setError(String(err));
        void stopRecording().then(() => setPhase('done'));
      });
    }, 30000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (phase !== 'done' || !jobId) return;
    setPlaybackRevision(value => value + 1);
    const refresh = () => {
      void queryClient.invalidateQueries({queryKey:['audio',jobId]});
      void queryClient.invalidateQueries({queryKey:['transcript',jobId]});
      void queryClient.invalidateQueries({queryKey:['audioFiles']});
    };
    refresh();
    // Finishing is idempotent; on interruption cancel releases the lease and
    // preserves the server's last audio/text checkpoint instead of abandoning it.
    if (session.current) void request(`/sessions/${session.current}/cancel`, {method:'POST'}).then(refresh).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, jobId, queryClient]);

  async function start() {
    await queue.current;
    setPhase('starting'); setError(''); setBlob(null); setResult(null);
    failure.current = false; sequence.current = 0; queued.current = 0;
    setInputSeconds(0); setPendingChunks(0); setActiveDevice('');
    chunks.current = []; queue.current = Promise.resolve(); session.current = '';
    try {
      if (!window.isSecureContext || !navigator.mediaDevices) throw new Error(t('Microphone requires HTTPS or localhost.'));
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, ...(deviceId !== 'default' ? {deviceId: {exact: deviceId}} : {}) }, video: false });
      setActiveDevice(stream.current.getAudioTracks()[0]?.label || t('System default microphone'));
      await refreshDevices();
      context.current = new AudioContext();
      await context.current.audioWorklet.addModule('/realtime-pcm.js');
      const data = await request('/sessions?autosave=1', { method: 'POST' });
      if (!mounted.current) {
        void request(`/sessions/${data.id}/cancel`, {method:'POST'}).catch(() => {});
        stopTracks();
        return;
      }
      if (!data.job_id) throw new Error(t('Automatic project creation failed'));
      setJobId(data.job_id); navigate(`/live?project=${data.job_id}`,{replace:true});
      void queryClient.invalidateQueries({queryKey:['audioFiles']});
      session.current = data.id; setResult(data);
      const active = new MediaRecorder(stream.current);
      recorder.current = active;
      active.ondataavailable = event => { if (event.data.size) chunks.current.push(event.data); };
      active.start(1000);
      const worklet = new AudioWorkletNode(context.current, 'meetingscribe-microphone-pcm');
      node.current = worklet;
      worklet.port.onmessage = ({ data }) => { if (data.pcm) enqueue(data.pcm); };
      const mute = context.current.createGain(); mute.gain.value = 0;
      const source = context.current.createMediaStreamSource(stream.current);
      analyser.current = context.current.createAnalyser(); analyser.current.fftSize = 2048;
      source.connect(analyser.current);
      source.connect(worklet).connect(mute).connect(context.current.destination);
      await context.current.resume();
      setPhase('recording');
    } catch (err) {
      stopTracks(); setPhase('idle'); setError(String(err instanceof Error ? err.message : err));
      if (session.current) void request(`/sessions/${session.current}/cancel`, { method: 'POST' }).catch(() => {});
    }
  }

  async function finish() {
    setPhase('finishing');
    try {
      const worklet = node.current;
      if (worklet && context.current?.state === 'running') {
        await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(() => reject(new Error(t('Audio flush timed out'))), 3000);
          worklet.port.onmessage = ({ data }) => {
            if (data.pcm) enqueue(data.pcm);
            if (data.flushed) { clearTimeout(timer); resolve(); }
          };
          worklet.port.postMessage('flush');
        });
      }
      await stopRecording();
      await queue.current;
      if (failure.current) throw new Error(t('Audio stream interrupted. Download your recording to transcribe it later.'));
      // Keep the lease alive while queued audio and alignment drain.
      const deadline = Date.now() + 240000;
      let completed = false;
      while (!completed) {
        let data: Result;
        try { data = await request(`/sessions/${session.current}/finish?async=1`, {method:'POST'}); }
        catch { data = await request(`/sessions/${session.current}/finish?async=1`, {method:'POST'}); }
        if (data.error) throw new Error(data.error);
        acceptResult(data);
        completed = data.finished !== false;
        if (!completed) {
          if (Date.now() > deadline) throw new Error(t('Final processing timed out. Saved audio and text are retained.'));
          await new Promise(resolve => window.setTimeout(resolve, 1000));
        }
      }
    } catch (err) {
      await stopRecording(); setError(String(err instanceof Error ? err.message : err));
    }
    setPhase('done');
  }

  async function pause() {
    setPhase('finishing');
    try {
      const worklet = node.current;
      if (worklet) {
        await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(() => reject(new Error(t('Audio flush timed out'))), 3000);
          worklet.port.onmessage = ({ data }) => {
            if (data.pcm) enqueue(data.pcm);
            if (data.flushed) { clearTimeout(timer); resolve(); }
          };
          worklet.port.postMessage('flush');
        });
      }
      // Suspend capture after flushing every pending sample.
      await context.current?.suspend();
      recorder.current?.pause();
      stream.current?.getAudioTracks().forEach(track => { track.enabled = false; });
      await queue.current;
      if (failure.current) throw new Error(t('Audio stream interrupted. Download your recording to transcribe it later.'));
      setResult(await request(`/sessions/${session.current}/pause`, { method: 'POST' }));
      setPlaybackRevision(v=>v+1);
      setPhase('paused');
    } catch (err) {
      await stopRecording(); setError(String(err)); setPhase('done');
    }
  }

  async function resume() {
    try {
      stream.current?.getAudioTracks().forEach(track => { track.enabled = true; });
      recorder.current?.resume();
      node.current?.port.postMessage('resume');
      await context.current?.resume();
      setPhase('recording');
    } catch (err) { setError(String(err)); }
  }

  async function refine(params: WhisperXParams, profileId?: string) {
    if (!jobId || busy || refineLoading) return;
    if (params.is_multi_track_enabled) {setError(t('Choose a single-track profile for this recording.'));return;}
    setRefineLoading(true);setError('');
    try {
      const response = await fetch(`/api/v1/transcription/${jobId}/start`, {
        method:'POST',headers:{...getAuthHeaders(),'Content-Type':'application/json'},
        body:JSON.stringify({...params,profile_id:profileId}),
      });
      if (!response.ok) {const data=await response.json();throw new Error(data.error || t('Transcription request failed'));}
      await queryClient.invalidateQueries({queryKey:['audio',jobId]});
      await queryClient.invalidateQueries({queryKey:['transcript',jobId]});
      void queryClient.invalidateQueries({queryKey:['audioFiles']});
      setRefineOpen(false);navigate(`/audio/${jobId}`);
    } catch(err) {setError(err instanceof Error ? err.message : String(err));}
    finally {setRefineLoading(false);}
  }

  function download() {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'MeetingScribe-live-recording.webm'; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  const busy = phase === 'starting' || phase === 'recording' || phase === 'paused' || phase === 'finishing';
  useEffect(() => {
    if (phase !== 'recording') return;
    const timer = window.setInterval(() => {
      if (!analyser.current) return;
      const samples = new Float32Array(analyser.current.fftSize);
      analyser.current.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, v) => sum + v*v, 0) / samples.length);
      setLevel(Math.min(100, Math.round(rms * 500)));
    }, 150);
    return () => clearInterval(timer);
  }, [phase]);
  useEffect(() => {
    if (!busy) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [busy]);
  const clock = (value: number) => `${Math.floor(value / 60).toString().padStart(2,'0')}:${Math.floor(value % 60).toString().padStart(2,'0')}`;
  const speakers = new Set(result?.segments.map(s => s.speaker).filter(Boolean));
  const statuses = {idle:'Ready', starting:'Connecting microphone…',recording:'Listening',paused:'Paused',finishing:'Confirming final transcript…',done:'Finished'};
  const controls = <section className="glass-card rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap justify-between gap-3"><strong>{t(statuses[phase])}</strong><span className={available && modelState !== 'ready' ? 'font-bold text-red-700 dark:text-red-300' : undefined}>{available ? t(modelState === 'ready' ? 'GPU models ready' : modelState === 'loading' ? 'Loading speech models…' : 'Speech models load when you start') : t('Realtime models are not ready. Existing recording and upload remain available.')}</span></div>
        {phase === 'starting' && <p role="status" className="text-sm font-bold text-red-700 dark:text-red-300">{t('Preparing speech models. Loading may take several minutes. Wait until Listening before speaking.')}</p>}
        <label className="block text-sm font-medium" htmlFor="live-microphone">{t('Microphone')}</label>
        <select id="live-microphone" className="w-full border rounded-lg px-3 py-2 bg-background" value={deviceId} disabled={busy} onChange={e=>setDeviceId(e.target.value)}>
          <option value="default">{t('System default microphone')}</option>
          {devices.filter(d=>d.deviceId !== 'default' && d.deviceId).map((d,i)=><option key={d.deviceId} value={d.deviceId}>{d.label || `${t('Microphone')} ${i+1}`}</option>)}
        </select>
        <p className="text-sm text-muted-foreground">{activeDevice ? `${t('Current microphone')}: ${activeDevice}` : t('Device names appear after microphone permission is granted.')}</p>
        <div className="flex items-center gap-3"><span className="text-sm">{t('Input level')}</span><meter aria-label={t('Input level')} min={0} max={100} value={phase === 'recording' ? level : 0} className="flex-1 h-4"/><span className="text-sm tabular-nums">{phase === 'recording' ? level : 0}%</span></div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div>{t('Captured audio')}<strong className="block text-xl tabular-nums">{clock(inputSeconds)}</strong></div>
          <div>{t('Processed audio')}<strong className="block text-xl tabular-nums">{clock(result?.duration || 0)}</strong></div>
          <div>{t('Detected speakers')}<strong className="block text-xl">{speakers.size}</strong></div>
          <div>{t('Pending audio chunks')}<strong className="block text-xl">{pendingChunks + Math.ceil(result?.pending_audio_seconds || 0)}</strong></div>
        </div>
        <p className="text-xs text-muted-foreground">{t('Draft text may change. Confirmed text is retained while timestamps and speaker labels are updated separately.')}</p>
        {!!result?.metadata?.pending_alignment && <p role="status" className="text-sm text-muted-foreground">{t('Confirmed text · timestamps and speakers pending')}</p>}
        {outdated && <p role="alert" className="text-amber-700 dark:text-amber-300">{t('A new version is available. Finish recording and download your audio before refreshing. Recording will not be interrupted.')}</p>}
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <div className="flex flex-wrap gap-2">
          {!busy && <Button disabled={!available || refineLoading || outdated} onClick={() => void start()}>{t('Start realtime transcription')}</Button>}
          {phase === 'recording' && <><Button onClick={() => void finish()}>{t('Finish recording')}</Button><Button variant="outline" onClick={() => void pause()}>{t('Pause')}</Button></>}
          {phase === 'paused' && <><Button onClick={() => void resume()}>{t('Resume')}</Button><Button variant="outline" onClick={() => void finish()}>{t('Finish recording')}</Button></>}
          {phase === 'finishing' && <p>{t('Confirming final transcript…')}</p>}
          {phase === 'done' && blob && <Button variant="outline" onClick={download}>{t('Download recording')}</Button>}
        </div>
        {busy && <p className="text-xs text-muted-foreground">{t('Finish recording before leaving this page.')}</p>}
        <p role="status" className="text-sm text-muted-foreground">{jobId ? `${t('Automatically saved audio')}: ${result ? clock(result.saved_duration || 0) : t('Open the saved project to review')}` : t('A project will be created and saved automatically when recording starts.')}</p>
        {jobId && <Button variant="outline" disabled={busy} onClick={()=>navigate(`/audio/${jobId}`)}>{t('Open saved project')}</Button>}
        {phase === 'done' && jobId && <><Button variant="outline" disabled={refineLoading} onClick={()=>setRefineOpen(true)}>{t('Refine with upload workflow')}</Button><p className="text-xs text-muted-foreground">{t('Reprocess the full recording with a saved profile. This updates this project’s transcript.')}</p></>}
        <TranscribeDDialog open={refineOpen} onOpenChange={setRefineOpen} onStartTranscription={(params,profileId)=>void refine(params,profileId)} loading={refineLoading}/>
        {phase === 'recording' && <p className="text-xs text-muted-foreground">{t('Pause recording to play saved audio. This avoids recording speaker playback.')}</p>}
      </section>;
  if (jobId) return <AudioDetailView audioId={jobId} liveControls={controls}
      transcriptOverride={result ? normalizeTranscriptResponse({transcript:result}) : undefined}
      livePartial={phase === 'done' ? undefined : result?.partial} liveActive={busy}
      playbackSrc={`/api/v1/transcription/${jobId}/audio?live_revision=${playbackRevision}`}
      playbackDisabled={phase === 'starting' || phase === 'recording' || phase === 'finishing'} />;
  return <MainLayout header={<Header />}><div className="space-y-6">
    <h1 className="text-2xl font-bold">{t('Realtime transcription')}</h1>
    <p className="text-sm text-muted-foreground">{t('Original speech with speaker labels. Draft text may change; speaker numbers apply to this session.')}</p>
    {controls}
  </div></MainLayout>;
}
