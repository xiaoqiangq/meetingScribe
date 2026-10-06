import { useInterfaceLanguage } from '@/i18n';
import { t as translateUI } from "@/i18n";
import React, { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Upload, Clock, CheckCircle, XCircle, FileAudio, Zap } from "lucide-react";
import { useTranscriptionProfiles, useQuickTranscription } from "@/features/transcription/hooks/useAudioFiles";
import type { Profile } from "@/features/transcription/hooks/useAudioFiles";
import { useAuth } from "@/features/auth/hooks/useAuth";
interface QuickTranscriptionJob {
    filename?: string;
    id: string;
    status: "pending" | "processing" | "completed" | "failed";
    transcript?: string;
    error_message?: string;
    created_at: string;
    expires_at: string;
}
interface TranscriptSegment {
    start: number;
    end: number;
    text: string;
    words?: Array<{
        word: string;
        start: number;
        end: number;
        score: number;
    }>;
}
interface TranscriptData {
    segments: TranscriptSegment[];
    language: string;
}
interface QuickTranscriptionDialogProps {
    isOpen: boolean;
    onClose: () => void;
}
export function QuickTranscriptionDialog({ isOpen, onClose }: QuickTranscriptionDialogProps) {
    useInterfaceLanguage();
    const { getAuthHeaders } = useAuth();
    const { data: profiles = [] } = useTranscriptionProfiles();
    const { mutateAsync: submitQuickTranscription } = useQuickTranscription();
    const [step, setStep] = useState<"upload" | "profile" | "processing" | "result">("upload");
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [selectedProfile, setSelectedProfile] = useState<string>("");
    const [job, setJob] = useState<QuickTranscriptionJob | null>(null);
    const [language, setLanguage] = useState("auto");
    const [recentJobs, setRecentJobs] = useState<QuickTranscriptionJob[]>([]);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
    // Set default profile when profiles load
    useEffect(() => {
        if (profiles.length > 0 && !selectedProfile) {
            const defaultProfile = profiles.find((p: Profile) => p.is_default) || profiles[0];
            if (defaultProfile) {
                setSelectedProfile(defaultProfile.name);
            }
        }
    }, [profiles, selectedProfile]);
    // Cleanup polling on unmount
    useEffect(() => {
        return () => {
            if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
            }
        };
    }, []);
    const handleFileSelect = () => {
        fileInputRef.current?.click();
    };
    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file && file.type.startsWith("audio/")) {
            setSelectedFile(file);
            setStep("profile");
        }
    };
    const handleSubmit = async () => {
        if (!selectedFile)
            return;
        setStep("processing");
        setError(null);
        try {
            const jobData = await submitQuickTranscription({
                file: selectedFile,
                profileName: selectedProfile || undefined,
                language: profiles.find(p => p.name === selectedProfile)?.parameters?.model === "Qwen/Qwen3-ASR-1.7B" ? language : undefined
            });
            setJob(jobData);
            setRecentJobs(items => [jobData, ...items.filter(j=>j.id !== jobData.id)]);
            startPolling(jobData.id);
        }
        catch (err) {
            setError(err instanceof Error ? translateUI(err.message) : "Failed to submit transcription");
            setStep("profile");
        }
    };
    const startPolling = (jobId: string) => {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = setInterval(async () => {
            try {
                const response = await fetch(`/api/v1/transcription/quick/${jobId}`, {
                    headers: getAuthHeaders(),
                });
                if (response.status === 404) {
                    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
                    setJob(null); setStep("upload"); setError(translateUI("Temporary task expired or is unavailable."));
                    return;
                }
                if (response.ok) {
                    const jobData = await response.json();
                    setJob(jobData);
                    if (jobData.status === "completed" || jobData.status === "failed") {
                        if (pollIntervalRef.current) {
                            clearInterval(pollIntervalRef.current);
                            pollIntervalRef.current = null;
                        }
                        setStep("result");
                    }
                }
            }
            catch (err) {
                console.error("Polling error:", err);
            }
        }, 2000); // Poll every 2 seconds
    };
    const handleClose = () => {
        if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
        }
        onClose();
    };
    useEffect(() => {
        if (!isOpen) return;
        let stopped = false;
        fetch('/api/v1/transcription/quick', {headers:getAuthHeaders()})
            .then(r => {if (!r.ok) throw new Error('Failed to load temporary tasks'); return r.json();})
            .then((items: QuickTranscriptionJob[]) => {
                if (stopped) return;
                setRecentJobs(items);
                if (job) {
                    const recovered = items.find(item => item.id === job.id);
                    if (recovered) resume(recovered); else {setJob(null); setStep('upload');}
                }
            }).catch(e => {if (!stopped) setError(e.message);});
        return () => { stopped = true; if (pollIntervalRef.current) clearInterval(pollIntervalRef.current); };
    }, [isOpen]);
    const resume = (item: QuickTranscriptionJob) => {
        setJob(item); setError(null);
        const active = item.status === 'pending' || item.status === 'processing';
        setStep(active ? 'processing' : 'result');
        if (active) startPolling(item.id);
    };
    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    };
    const formatTranscript = (transcript: string): React.ReactElement[] => {
        try {
            const data: TranscriptData = JSON.parse(transcript);
            return data.segments.map((segment, index) => (<div key={index} className="mb-4 p-3 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-card)]">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-mono text-[var(--text-tertiary)] bg-[var(--bg-main)] px-2 py-1 rounded">
              {formatTime(segment.start)} - {formatTime(segment.end)}
            </span>
          </div>
          <p className="text-[var(--text-primary)] leading-relaxed">
            {segment.text.trim()}
          </p>
        </div>));
        }
        catch {
            // Fallback for plain text
            return [
                <div key="fallback" className="p-3 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-card)]">
          <p className="text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap">
            {transcript}
          </p>
        </div>
            ];
        }
    };
    const getExpiryInfo = (): string => {
        if (!job?.expires_at)
            return "";
        const expiryTime = new Date(job.expires_at);
        return translateUI("Expires at") + ": " + expiryTime.toLocaleString();
    };
    return (<Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-[var(--warning-solid)]"/>{translateUI("Quick Transcription")}</DialogTitle>
          <DialogDescription>{translateUI("Temporary content expires after 6 hours; files are removed in the background.")}</DialogDescription>
        </DialogHeader>

        {recentJobs.length > 0 && <div className="space-y-2">
          <label className="text-sm">{translateUI("Temporary tasks (available for 6 hours)")}</label>
          <select aria-label={translateUI("Temporary tasks")} className="w-full border rounded p-2 bg-[var(--bg-card)]" value={job?.id || ''} onChange={e => {const item=recentJobs.find(j=>j.id===e.target.value); if(item)resume(item);}}>
            <option value="">{translateUI("Choose a temporary task")}</option>
            {recentJobs.map(item=><option key={item.id} value={item.id}>{item.filename || item.id.slice(0,8)} · {translateUI(item.id === job?.id ? job.status : item.status)}</option>)}
          </select>
          <Button variant="outline" onClick={() => {setJob(null);setSelectedFile(null);setStep('upload');setError(null);}}>{translateUI("New transcription")}</Button>
        </div>}
        {error && <p role="alert" className="text-sm text-[var(--error)]">{error}</p>}
        {step === "upload" && (<div className="space-y-4">
            <Card className="border-2 border-dashed border-[var(--border-subtle)] hover:border-[var(--warning-solid)] cursor-pointer transition-colors bg-[var(--bg-card)]" onClick={handleFileSelect}>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Upload className="h-12 w-12 text-[var(--text-tertiary)] mb-4"/>
                <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">{translateUI("Select Audio File")}</h3>
                <p className="text-[var(--text-secondary)] text-center">{translateUI("Click to choose an audio file from your device")}</p>
              </CardContent>
            </Card>

            <input ref={fileInputRef} type="file" accept="audio/*" onChange={handleFileChange} className="hidden"/>
          </div>)}

        {step === "profile" && (<div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-[var(--warning-translucent)] rounded-[var(--radius-card)]">
              <FileAudio className="h-8 w-8 text-[var(--warning-solid)]"/>
              <div>
                <h3 className="font-medium text-[var(--text-primary)]">
                  {selectedFile?.name}
                </h3>
                <p className="text-sm text-[var(--text-secondary)]">
                  {selectedFile && (selectedFile.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--text-primary)]">{translateUI("Transcription Profile")}</label>
              <Select value={selectedProfile} onValueChange={setSelectedProfile}>
                <SelectTrigger>
                  <SelectValue placeholder={translateUI("Select a profile or use default settings")}/>
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((profile) => (<SelectItem key={profile.id} value={profile.name}>
                      <div className="flex items-center gap-2">
                        <span>{profile.name}</span>
                        {profile.is_default && (<span className="text-xs bg-[var(--warning-translucent)] text-[var(--warning-solid)] px-2 py-0.5 rounded">{translateUI("Default")}</span>)}
                      </div>
                    </SelectItem>))}
                </SelectContent>
              </Select>
              <p className="text-xs text-[var(--text-tertiary)]">{translateUI("Leave empty to use default settings")}</p>
            </div>

            {profiles.find(p => p.name === selectedProfile)?.parameters?.model === 'Qwen/Qwen3-ASR-1.7B' && <div className="space-y-2">
              <label className="text-sm">{translateUI("Audio language")}</label>
              <select aria-label={translateUI("Audio language")} className="w-full rounded border p-2 bg-[var(--bg-card)]" value={language} onChange={e=>setLanguage(e.target.value)}>
                {Object.entries({auto:'Auto-detect',zh:'Chinese',en:'English',yue:'Cantonese',fr:'French',de:'German',it:'Italian',ja:'Japanese',ko:'Korean',pt:'Portuguese',ru:'Russian',es:'Spanish'}).map(([code,label])=><option key={code} value={code}>{translateUI(label)}</option>)}
              </select>
            </div>}
            {error && (<div className="p-3 bg-[var(--error)]/10 border border-[var(--error)]/20 rounded-[var(--radius-input)]">
                <p className="text-sm text-[var(--error)]">{error}</p>
              </div>)}

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={handleClose}>{translateUI("Cancel")}</Button>
              <Button onClick={handleSubmit}>{translateUI("Start Transcription")}</Button>
            </div>
          </div>)}

        {step === "processing" && job && (<div className="space-y-4 text-center">
            <div className="flex flex-col items-center">
              <Clock className="h-12 w-12 text-[var(--warning-solid)] animate-spin mb-4"/>
              <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">{translateUI(job.status === "pending" ? "Waiting in queue..." : "Transcribing Audio...")}</h3>
              <p className="text-[var(--text-secondary)]">{translateUI("This may take a few minutes depending on the audio length")}</p>
              <p className="text-xs text-[var(--text-tertiary)] mt-2">
                {getExpiryInfo()}
              </p>
            </div>

            <div className="text-left bg-[var(--bg-card)] p-4 rounded-[var(--radius-card)] border border-[var(--border-subtle)]">
              <h4 className="font-medium mb-2 text-[var(--text-primary)]">{translateUI("Job Details:")}</h4>
              <p className="text-sm text-[var(--text-secondary)]">ID: {job.id}</p>
              <p className="text-sm text-[var(--text-secondary)]">{translateUI("Status:")}{translateUI(job.status)}</p>
            </div>

            <Button variant="outline" onClick={handleClose}>{translateUI("Cancel")}</Button>
          </div>)}

        {step === "result" && job && (<div className="space-y-4">
            {job.status === "completed" && job.transcript ? (<>
                <div className="flex items-center gap-2 p-3 bg-[var(--success-translucent)] rounded-[var(--radius-card)]">
                  <CheckCircle className="h-5 w-5 text-[var(--success-solid)]"/>
                  <div>
                    <h3 className="font-medium text-[var(--text-primary)]">{translateUI("Transcription Complete")}</h3>
                    <p className="text-sm text-[var(--success-solid)]">
                      {getExpiryInfo()}
                    </p>
                  </div>
                </div>

                <div className="max-h-96 overflow-y-auto space-y-2">
                  {formatTranscript(job.transcript)}
                </div>

                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => {
                    if (job.transcript) {
                        navigator.clipboard.writeText(JSON.parse(job.transcript).segments.map((s: TranscriptSegment) => s.text.trim()).join('\n'));
                    }
                }}>{translateUI("Copy Text")}</Button>
                  <Button onClick={handleClose}>{translateUI("Close")}</Button>
                </div>
              </>) : (<>
                <div className="flex items-center gap-2 p-3 bg-[var(--error)]/10 border border-[var(--error)]/20 rounded-[var(--radius-card)]">
                  <XCircle className="h-5 w-5 text-[var(--error)]"/>
                  <div>
                    <h3 className="font-medium text-[var(--text-primary)]">{translateUI("Transcription Failed")}</h3>
                    <p className="text-sm text-[var(--error)]">
                      {job.error_message || "An unknown error occurred"}
                    </p>
                  </div>
                </div>

                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => setStep("upload")}>{translateUI("Try Again")}</Button>
                  <Button onClick={handleClose}>{translateUI("Close")}</Button>
                </div>
              </>)}
          </div>)}
      </DialogContent>
    </Dialog>);
}
