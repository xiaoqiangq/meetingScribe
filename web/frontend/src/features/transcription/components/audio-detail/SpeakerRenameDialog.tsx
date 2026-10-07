import { selectTopicLinks, type TopicLink } from "./topicLinks";
import { playSpeakerPreview } from "./speakerPreview";
import { useInterfaceLanguage } from '@/i18n';
import { t as translateUI } from "@/i18n";
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Users, Save, X } from 'lucide-react';
import { useAuth } from "@/features/auth/hooks/useAuth";
// Note: Install framer-motion for enhanced animations
// import { motion, AnimatePresence } from 'framer-motion';
interface SpeakerMapping {
    id?: number;
    original_speaker: string;
    custom_name: string;
    person_id?: string;
}
interface TopicCandidate {
    person_id: string;
    name: string;
    cosine: number;
}
interface TopicSpeaker {
    speaker: string;
    topic: string;
    status: string;
    suggested_name?: string;
    scores: TopicCandidate[];
    windows: {
        start: number;
        end: number;
    }[];
}
interface TopicRecommendations {
    speakers: TopicSpeaker[];
    links: {
        left: string;
        right: string;
        cosine: number;
    }[];
    notice?: string;
}
interface SpeakerRenameDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    transcriptionId: string;
    onSpeakerMappingsUpdate: (mappings: SpeakerMapping[]) => void;
    initialSpeakers?: string[]; // Detected speakers from transcript
}
const SpeakerRenameDialog: React.FC<SpeakerRenameDialogProps> = ({ open, onOpenChange, transcriptionId, onSpeakerMappingsUpdate, initialSpeakers: suppliedSpeakers = [], }) => {
    useInterfaceLanguage();
    // Parent audio updates create new arrays; reload only when speaker values change.
    const speakerKey = JSON.stringify(suppliedSpeakers);
    const initialSpeakers = useMemo<string[]>(() => JSON.parse(speakerKey), [speakerKey]);
    const { getAuthHeaders } = useAuth();
    const [speakerMappings, setSpeakerMappings] = useState<Record<string, string>>({});
    const [personIds, setPersonIds] = useState<Record<string, string>>({});
    const [recommendations, setRecommendations] = useState<TopicRecommendations>();
    const [previewUrl, setPreviewUrl] = useState<string>();
    const [previewWindow, setPreviewWindow] = useState<{ start: number; end: number }>();
    const [previewLoading, setPreviewLoading] = useState(false);
    const previewRequest = useRef(0);
    const fallbackStarted = useRef(false);
    const [linkMinimum, setLinkMinimum] = useState(0.5);
    const audioRef = useRef<HTMLAudioElement>(null);
    const previewEnd = useRef<number | undefined>(undefined);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fetchSpeakerMappings = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetch(`/api/v1/transcription/${transcriptionId}/speakers`, {
                headers: { ...getAuthHeaders() },
            });
            if (!response.ok) {
                throw new Error(`Failed to fetch speaker mappings: ${response.statusText}`);
            }
            const existingMappings: SpeakerMapping[] = await response.json();
            // Create a mapping object from the response
            const mappingObj: Record<string, string> = {};
            // Initialize with existing mappings
            existingMappings.forEach(mapping => {
                mappingObj[mapping.original_speaker] = mapping.custom_name;
            });
            // Add any speakers from the transcript that don't have mappings yet
            initialSpeakers.forEach((speaker, index) => {
                if (!mappingObj[speaker]) {
                    mappingObj[speaker] = speaker.startsWith('topic') ? speaker : (translateUI("\u8BF4\u8BDD\u4EBA ") + (index + 1) + "");
                }
            });
            setSpeakerMappings(mappingObj);
            setPersonIds(Object.fromEntries(existingMappings.filter(m => m.person_id).map(m => [m.original_speaker, m.person_id!])));
            setRecommendations(undefined);
            {
                try {
                    const recommendationResponse = await fetch(`/api/v1/transcription/${transcriptionId}/topic-recommendations`, { headers: getAuthHeaders() });
                    if (recommendationResponse.ok) {
                        const report: TopicRecommendations = await recommendationResponse.json();
                        if (report.speakers.length > 0 || report.notice)
                            setRecommendations(report);
                    }
                    else
                        setRecommendations({ speakers: [], links: [], notice: translateUI("\u63A8\u8350\u6682\u4E0D\u53EF\u7528\uFF0C\u5DF2\u786E\u8BA4\u59D3\u540D\u4ECD\u7136\u4FDD\u7559\u3002") });
                }
                catch {
                    setRecommendations({ speakers: [], links: [], notice: translateUI("\u63A8\u8350\u6682\u4E0D\u53EF\u7528\uFF0C\u5DF2\u786E\u8BA4\u59D3\u540D\u4ECD\u7136\u4FDD\u7559\u3002") });
                }
            }
        }
        catch (err) {
            console.error('Error fetching speaker mappings:', err);
            setError(err instanceof Error ? translateUI(err.message) : 'Failed to fetch speaker mappings');
            // Initialize with default mappings if fetch fails
            const defaultMappings: Record<string, string> = {};
            initialSpeakers.forEach((speaker, index) => {
                defaultMappings[speaker] = speaker.startsWith('topic') ? speaker : (translateUI("\u8BF4\u8BDD\u4EBA ") + (index + 1) + "");
            });
            setSpeakerMappings(defaultMappings);
        }
        finally {
            setIsLoading(false);
        }
    }, [transcriptionId, getAuthHeaders, initialSpeakers]);
    // Initialize speaker mappings when dialog opens
    useEffect(() => {
        if (open && transcriptionId) {
            fetchSpeakerMappings();
        }
    }, [open, transcriptionId, fetchSpeakerMappings]);
    const handleSpeakerNameChange = (originalSpeaker: string, customName: string) => {
        setSpeakerMappings(prev => {
            const next = { ...prev, [originalSpeaker]: customName };
            if (personIds[originalSpeaker])
                Object.keys(next).forEach(s => {
                    if (personIds[s] === personIds[originalSpeaker])
                        next[s] = customName;
                });
            return next;
        });
    };
    const saveSpeakerMappings = async () => {
        setIsSaving(true);
        setError(null);
        try {
            // Convert mappings to API format
            const mappingsArray = Object.entries(speakerMappings).map(([original_speaker, custom_name]) => ({
                original_speaker,
                custom_name,
                person_id: personIds[original_speaker] || undefined,
            }));
            const response = await fetch(`/api/v1/transcription/${transcriptionId}/speakers`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({
                    mappings: mappingsArray,
                }),
            });
            if (!response.ok) {
                throw new Error(`Failed to save speaker mappings: ${response.statusText}`);
            }
            const updatedMappings: SpeakerMapping[] = await response.json();
            onSpeakerMappingsUpdate(updatedMappings);
            onOpenChange(false);
        }
        catch (err) {
            console.error('Error saving speaker mappings:', err);
            setError(err instanceof Error ? translateUI(err.message) : 'Failed to save speaker mappings');
        }
        finally {
            setIsSaving(false);
        }
    };
    useEffect(() => () => {
        if (previewUrl?.startsWith('blob:'))
            URL.revokeObjectURL(previewUrl);
    }, [previewUrl]);
    useEffect(() => {
        previewRequest.current += 1;
        if (!open) {
            fallbackStarted.current = false;
            audioRef.current?.pause();
            previewEnd.current = undefined;
            setPreviewWindow(undefined);
            setPreviewLoading(false);
        }
    }, [open]);
    useEffect(() => {
        setPreviewUrl(undefined);
        fallbackStarted.current = false;
        setPreviewWindow(undefined);
        previewRequest.current += 1;
    }, [transcriptionId]);
    useEffect(() => {
        const audio = audioRef.current;
        if (!open || !audio || !previewUrl || !previewWindow) return;
        return playSpeakerPreview(audio, previewWindow, {
            started: () => setPreviewLoading(false),
            failed: (message) => {
                setPreviewLoading(false);
                setError(translateUI(message));
            },
            setEnd: end => { previewEnd.current = end; },
        });
    }, [open, previewUrl, previewWindow]);
    const pauseProjectAudio = () => window.dispatchEvent(new Event('huiji:preview-start'));
    const listen = (window: { start: number; end: number }) => {
        previewRequest.current += 1;
        setPreviewLoading(true);
        setError(null);
        pauseProjectAudio();
        audioRef.current?.pause();
        // The server supports byte ranges, as used by the project player.
        if (!previewUrl) setPreviewUrl(`/api/v1/transcription/${transcriptionId}/audio`);
        setPreviewWindow({ ...window });
    };
    const recoverAudio = async () => {
        if (fallbackStarted.current) return;
        fallbackStarted.current = true;
        const request = previewRequest.current;
        setPreviewLoading(true);
        setError(null);
        try {
            const response = await fetch(`/api/v1/transcription/${transcriptionId}/audio`, {
                headers: getAuthHeaders(), credentials: 'include',
            });
            if (!response.ok) throw new Error(translateUI('无法读取音频'));
            const blob = await response.blob();
            if (request !== previewRequest.current) return;
            setPreviewUrl(URL.createObjectURL(blob));
        } catch (err) {
            if (request === previewRequest.current) {
                setPreviewLoading(false);
                setError(err instanceof Error ? translateUI(err.message) : translateUI('试听失败'));
            }
        }
    };
    const confirmName = (speaker: string, candidate: TopicCandidate) => {
        setPersonIds(prev => ({ ...prev, [speaker]: candidate.person_id }));
        setSpeakerMappings(prev => {
            const next = { ...prev, [speaker]: candidate.name };
            Object.keys(next).forEach(s => {
                if (personIds[s] === candidate.person_id)
                    next[s] = candidate.name;
            });
            return next;
        });
    };
    const linkPeople = (left: string, right: string) => {
        const id = personIds[left] || `meeting:${crypto.randomUUID()}`;
        const rightId = personIds[right];
        const members = initialSpeakers.filter(s => s === left || s === right || (rightId && personIds[s] === rightId));
        setPersonIds(prev => { const next = { ...prev }; members.forEach(s => { next[s] = id; }); return next; });
        setSpeakerMappings(prev => { const next = { ...prev }; members.forEach(s => { next[s] = prev[left]; }); return next; });
    };
    const links = selectTopicLinks(recommendations?.links || [], personIds, linkMinimum);
    const renderLink = (link: TopicLink, confirmed = false) => <div key={JSON.stringify([link.left, link.right].sort())} className="text-xs flex items-center gap-2 flex-wrap rounded border p-2">
        <span>{link.left} ↔ {link.right} · {translateUI('相似度：')}{link.cosine.toFixed(2)}</span>
        <Button size="sm" variant="outline" disabled={!recommendations?.speakers.find(s => s.speaker === link.left)?.windows.length} onClick={() => { const w = recommendations?.speakers.find(s => s.speaker === link.left)?.windows[0]; if (w) listen(w); }}>{translateUI('试听左侧')}</Button>
        <Button size="sm" variant="outline" disabled={!recommendations?.speakers.find(s => s.speaker === link.right)?.windows.length} onClick={() => { const w = recommendations?.speakers.find(s => s.speaker === link.right)?.windows[0]; if (w) listen(w); }}>{translateUI('试听右侧')}</Button>
        {confirmed ? <span>{translateUI('已关联（点击保存后生效）')}</span> : <Button size="sm" variant="outline" onClick={() => linkPeople(link.left, link.right)}>{translateUI('确认同一人')}</Button>}
    </div>;
    const speakers = initialSpeakers.filter(speaker => speaker in speakerMappings);
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5"/>
            {recommendations ? (initialSpeakers.some(s => s.startsWith('topic')) ? translateUI("Topic \u4EBA\u7269\u4E0E\u59D3\u540D\u786E\u8BA4") : translateUI("\u4EBA\u7269\u4E0E\u59D3\u540D\u786E\u8BA4")) : translateUI("\u4FEE\u6539\u89D2\u8272\u540D")}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (<div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin"/>
            <span className="ml-2 text-sm text-muted-foreground">{translateUI("Loading speakers...")}</span>
          </div>) : (<div className="space-y-4">
            {error && (<div className="p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>)}

            {speakers.length === 0 ? (<Card>
                <CardContent className="pt-6 text-center text-muted-foreground">
                  <Users className="h-8 w-8 mx-auto mb-2 opacity-50"/>
                  <p>{translateUI("\u6CA1\u6709\u68C0\u6D4B\u5230\u53EF\u547D\u540D\u7684\u8BF4\u8BDD\u4EBA\u3002")}</p>
                </CardContent>
              </Card>) : (<div className="space-y-3 max-h-[55vh] overflow-y-auto">
                {speakers.map((speaker) => (<div key={speaker} className="space-y-1">
                    <Label htmlFor={`speaker-${speaker}`} className="text-xs font-medium text-muted-foreground">
                      {speaker.startsWith("topic") ? speaker : (translateUI("\u8BF4\u8BDD\u4EBA ") + (initialSpeakers.indexOf(speaker) + 1) + " (" + speaker + ")")}
                    </Label>
                    {recommendations?.speakers.filter(row => row.speaker === speaker).map(row => <div key={row.speaker} className="space-y-2 text-xs text-muted-foreground">
                      <p>{row.status === 'suggested' ? (translateUI("\u63A8\u8350\uFF1A") + row.suggested_name + "") : row.status === 'insufficient_audio' ? translateUI("\u6E05\u6670\u8BED\u97F3\u4E0D\u8DB3\uFF0C\u6682\u4E0D\u63A8\u8350") : (translateUI("\u7B2C\u4E00\u59D3\u540D\u5019\u9009\uFF1A") + (row.scores[0]?.name || translateUI("\u6682\u65E0")) + translateUI("\uFF08\u672A\u786E\u8BA4\uFF0C\u8BF7\u5148\u8BD5\u542C\uFF09"))}</p>
                      <div className="flex flex-wrap gap-2">{row.windows.map((w, i) => <Button key={i} size="sm" variant="outline" onClick={() => void listen(w)}>{translateUI("\u8BD5\u542C")}{i + 1}</Button>)}</div>
                      <div className="flex flex-wrap gap-2">{row.scores.slice(0, 3).map(candidate => <Button key={candidate.person_id} size="sm" variant="outline" onClick={() => confirmName(speaker, candidate)}>{translateUI("\u786E\u8BA4")}{candidate.name}{translateUI("\uFF08\u76F8\u4F3C\u5EA6")}{candidate.cosine.toFixed(2)}）</Button>)}</div>
                      {personIds[speaker] && <Button size="sm" variant="ghost" onClick={() => { setPersonIds(prev => ({ ...prev, [speaker]: '' })); setSpeakerMappings(prev => ({ ...prev, [speaker]: speaker })); }}>{translateUI("\u89E3\u9664\u4EBA\u7269\u5173\u8054 / \u64A4\u9500\u59D3\u540D")}</Button>}
                    </div>)}
                    <Input id={`speaker-${speaker}`} value={speakerMappings[speaker] || ''} onChange={(e) => handleSpeakerNameChange(speaker, e.target.value)} placeholder={translateUI("\u8F93\u5165\u59D3\u540D\u6216\u89D2\u8272\u540D\u79F0")} className="transition-all duration-200 focus:ring-2 focus:ring-primary/20"/>
                  </div>))}
              </div>)}
          </div>)}

        {recommendations && <div className="space-y-2 border-t pt-2">
          <p className="text-xs text-muted-foreground">{recommendations.notice}{translateUI("\u4FEE\u6539\u540E\u70B9\u51FB\u4FDD\u5B58\u624D\u751F\u6548\u3002\u540C\u4E00\u4EBA\u7269\u5173\u8054\u7684\u59D3\u540D\u4F1A\u4E00\u8D77\u66F4\u65B0\u3002")}</p>
          {previewLoading && <p role="status" className="text-xs text-muted-foreground">{translateUI("Loading audio...")}</p>}
          <audio ref={audioRef} src={previewUrl} preload="metadata" crossOrigin="use-credentials" onPlay={pauseProjectAudio} onError={() => void recoverAudio()} controls className="w-full h-10" onTimeUpdate={() => {
                if (audioRef.current && previewEnd.current !== undefined && audioRef.current.currentTime >= previewEnd.current)
                    audioRef.current.pause();
            }}/>
          {recommendations.links.length > 0 && <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{translateUI('跨 topic 高分候选')}（{links.recommended.length}）</p>
              <label className="text-xs flex items-center gap-1">{translateUI('最低相似度')}
                <select aria-label={translateUI('最低相似度')} className="rounded border bg-background p-1" value={linkMinimum} onChange={e => setLinkMinimum(Number(e.target.value))}>
                  {[0.4, 0.5, 0.6, 0.7].map(value => <option key={value} value={value}>{value.toFixed(1)}</option>)}
                </select>
              </label>
            </div>
            <p className="text-xs text-muted-foreground">{translateUI('每个人最多推荐两条联系；分数不是正确概率，请试听后确认。')}</p>
            <div className="max-h-40 overflow-y-auto space-y-2">
              {links.recommended.map(link => renderLink(link))}
              {!links.recommended.length && <p className="text-xs text-muted-foreground">{translateUI('暂无符合门槛的候选，可调整门槛或查看其他联系。')}</p>}
            </div>
            {links.confirmed.length > 0 && <details><summary className="cursor-pointer text-sm">{translateUI('已关联人物')}（{links.confirmed.length}）</summary><div className="max-h-40 overflow-y-auto space-y-2">{links.confirmed.map(link => renderLink(link, true))}</div></details>}
            {links.other.length > 0 && <details><summary className="cursor-pointer text-sm">{translateUI('查看其他联系')}（{links.other.length}）</summary><div className="max-h-40 overflow-y-auto space-y-2">{links.other.map(link => renderLink(link))}</div></details>}
          </div>}
        </div>}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            <X className="h-4 w-4 mr-1"/>{translateUI("\u53D6\u6D88")}</Button>
          <Button onClick={saveSpeakerMappings} disabled={isSaving || speakers.length === 0} className="min-w-[100px]">
            {isSaving ? (<>
                <Loader2 className="h-4 w-4 mr-1 animate-spin"/>{translateUI("\u4FDD\u5B58\u4E2D...")}</>) : (<>
                <Save className="h-4 w-4 mr-1"/>{translateUI("\u4FDD\u5B58")}</>)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>);
};
export default SpeakerRenameDialog;
