import React, { useState, useEffect, useCallback, useRef } from 'react';
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

interface TopicCandidate { person_id: string; name: string; cosine: number }
interface TopicSpeaker { speaker: string; topic: string; status: string; suggested_name?: string; scores: TopicCandidate[]; windows: {start: number; end: number}[] }
interface TopicRecommendations { speakers: TopicSpeaker[]; links: {left: string; right: string; cosine: number}[]; notice?: string }

interface SpeakerRenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transcriptionId: string;
  onSpeakerMappingsUpdate: (mappings: SpeakerMapping[]) => void;
  initialSpeakers?: string[]; // Detected speakers from transcript
}

const SpeakerRenameDialog: React.FC<SpeakerRenameDialogProps> = ({
  open,
  onOpenChange,
  transcriptionId,
  onSpeakerMappingsUpdate,
  initialSpeakers = [],
}) => {
  const { getAuthHeaders } = useAuth();
  const [speakerMappings, setSpeakerMappings] = useState<Record<string, string>>({});
  const [personIds, setPersonIds] = useState<Record<string, string>>({});
  const [recommendations, setRecommendations] = useState<TopicRecommendations>();
  const [previewUrl, setPreviewUrl] = useState<string>();
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
          mappingObj[speaker] = speaker.startsWith('topic') ? speaker : `说话人 ${index + 1}`;
        }
      });

      setSpeakerMappings(mappingObj);
      setPersonIds(Object.fromEntries(existingMappings.filter(m => m.person_id).map(m => [m.original_speaker, m.person_id!])));
      setRecommendations(undefined);
      {
        try {
          const recommendationResponse = await fetch(`/api/v1/transcription/${transcriptionId}/topic-recommendations`, {headers: getAuthHeaders()});
          if (recommendationResponse.ok) {
            const report: TopicRecommendations = await recommendationResponse.json();
            if (report.speakers.length > 0 || report.notice) setRecommendations(report);
          }
          else setRecommendations({speakers: [], links: [], notice: '推荐暂不可用，已确认姓名仍然保留。'});
        } catch { setRecommendations({speakers: [], links: [], notice: '推荐暂不可用，已确认姓名仍然保留。'}); }
      }
    } catch (err) {
      console.error('Error fetching speaker mappings:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch speaker mappings');

      // Initialize with default mappings if fetch fails
      const defaultMappings: Record<string, string> = {};
      initialSpeakers.forEach((speaker, index) => {
        defaultMappings[speaker] = speaker.startsWith('topic') ? speaker : `说话人 ${index + 1}`;
      });
      setSpeakerMappings(defaultMappings);
    } finally {
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
      const next = {...prev, [originalSpeaker]: customName};
      if (personIds[originalSpeaker]) Object.keys(next).forEach(s => { if (personIds[s] === personIds[originalSpeaker]) next[s] = customName; });
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
    } catch (err) {
      console.error('Error saving speaker mappings:', err);
      setError(err instanceof Error ? err.message : 'Failed to save speaker mappings');
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  const listen = async (window: {start: number; end: number}) => {
    try {
      let url = previewUrl;
      if (!url) {
        const response = await fetch(`/api/v1/transcription/${transcriptionId}/audio`, {headers: getAuthHeaders()});
        if (!response.ok) throw new Error('无法读取音频');
        url = URL.createObjectURL(await response.blob()); setPreviewUrl(url);
      }
      const audio = audioRef.current;
      if (!audio) return;
      audio.src = url; previewEnd.current = window.end;
      audio.onloadedmetadata = () => { audio.currentTime = window.start; void audio.play().catch(() => setError('请点击播放器播放')); };
      audio.load();
    } catch (err) { setError(err instanceof Error ? err.message : '试听失败'); }
  };
  const confirmName = (speaker: string, candidate: TopicCandidate) => {
    setPersonIds(prev => ({...prev, [speaker]: candidate.person_id}));
    setSpeakerMappings(prev => {
      const next = {...prev, [speaker]: candidate.name};
      Object.keys(next).forEach(s => { if (personIds[s] === candidate.person_id) next[s] = candidate.name; });
      return next;
    });
  };
  const linkPeople = (left: string, right: string) => {
    const id = personIds[left] || `meeting:${crypto.randomUUID()}`;
    const rightId = personIds[right];
    const members = initialSpeakers.filter(s => s === left || s === right || (rightId && personIds[s] === rightId));
    setPersonIds(prev => { const next = {...prev}; members.forEach(s => {next[s] = id;}); return next; });
    setSpeakerMappings(prev => { const next = {...prev}; members.forEach(s => {next[s] = prev[left];}); return next; });
  };

  const speakers = initialSpeakers.filter(speaker => speaker in speakerMappings);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {recommendations ? (initialSpeakers.some(s => s.startsWith('topic')) ? "Topic 人物与姓名确认" : "人物与姓名确认") : "修改角色名"}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="ml-2 text-sm text-muted-foreground">Loading speakers...</span>
          </div>
        ) : (
          <div className="space-y-4">
            {error && (
              <div className="p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            {speakers.length === 0 ? (
              <Card>
                <CardContent className="pt-6 text-center text-muted-foreground">
                  <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>没有检测到可命名的说话人。</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3 max-h-[55vh] overflow-y-auto">
                {speakers.map((speaker) => (
                  <div
                    key={speaker}
                    className="space-y-1"
                  >
                    <Label htmlFor={`speaker-${speaker}`} className="text-xs font-medium text-muted-foreground">
                      {speaker.startsWith("topic") ? speaker : `说话人 ${initialSpeakers.indexOf(speaker) + 1} (${speaker})`}
                    </Label>
                    {recommendations?.speakers.filter(row => row.speaker === speaker).map(row => <div key={row.speaker} className="space-y-2 text-xs text-muted-foreground">
                      <p>{row.status === 'suggested' ? `推荐：${row.suggested_name}` : row.status === 'insufficient_audio' ? '清晰语音不足，暂不推荐' : `第一姓名候选：${row.scores[0]?.name || '暂无'}（未确认，请先试听）`}</p>
                      <div className="flex flex-wrap gap-2">{row.windows.map((w, i) => <Button key={i} size="sm" variant="outline" onClick={() => void listen(w)}>试听 {i + 1}</Button>)}</div>
                      <div className="flex flex-wrap gap-2">{row.scores.slice(0, 3).map(candidate => <Button key={candidate.person_id} size="sm" variant="outline" onClick={() => confirmName(speaker, candidate)}>确认 {candidate.name}（相似度 {candidate.cosine.toFixed(2)}）</Button>)}</div>
                      {personIds[speaker] && <Button size="sm" variant="ghost" onClick={() => {setPersonIds(prev => ({...prev, [speaker]: ''})); setSpeakerMappings(prev => ({...prev, [speaker]: speaker}));}}>解除人物关联 / 撤销姓名</Button>}
                    </div>)}
                    <Input
                      id={`speaker-${speaker}`}
                      value={speakerMappings[speaker] || ''}
                      onChange={(e) => handleSpeakerNameChange(speaker, e.target.value)}
                      placeholder="输入姓名或角色名称"
                      className="transition-all duration-200 focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {recommendations && <div className="space-y-2 border-t pt-2">
          <p className="text-xs text-muted-foreground">{recommendations.notice} 修改后点击保存才生效。同一人物关联的姓名会一起更新。</p>
          <audio ref={audioRef} controls className="w-full h-10" onTimeUpdate={() => { if (audioRef.current && previewEnd.current !== undefined && audioRef.current.currentTime >= previewEnd.current) audioRef.current.pause(); }} />
          {recommendations.links.length > 0 && <details><summary className="cursor-pointer text-sm">跨 topic 人物联系（{recommendations.links.length} 条）</summary>
            <div className="max-h-40 overflow-y-auto space-y-2">{recommendations.links.map(link => <div key={link.left + link.right} className="text-xs flex items-center gap-2 flex-wrap">
              <span>{link.left} ↔ {link.right}（{link.cosine.toFixed(2)}）</span>
              <Button size="sm" variant="outline" onClick={() => linkPeople(link.left, link.right)}>确认同一人</Button>
              {personIds[link.left] && personIds[link.left] === personIds[link.right] && <span>已关联，待保存</span>}
            </div>)}</div>
          </details>}
        </div>}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            <X className="h-4 w-4 mr-1" />
            取消
          </Button>
          <Button
            onClick={saveSpeakerMappings}
            disabled={isSaving || speakers.length === 0}
            className="min-w-[100px]"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                保存中...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-1" />
                保存
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SpeakerRenameDialog;
