import { useInterfaceLanguage } from '@/i18n';
import { t as translateUI } from "@/i18n";
import { Label } from "@/components/ui/label";
import { useState, useEffect, memo } from "react";
import { NVIDIA_DIARIZATION_OPTIONS, isNvidiaDiarizationModel, preferredNvidiaDiarization, speakerSelection } from './diarizationOptions';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, } from "@/components/ui/accordion";
import { Loader2, Check, XCircle } from "lucide-react";
import { useAuth } from "@/features/auth/hooks/useAuth";
import { FormField, Section, InfoBanner } from "@/components/transcription/FormHelpers";
// ============================================================================
// Types & Constants
// ============================================================================
import { parseTopicTimes, formatTopicTime } from "./topicTimes";
export interface WhisperXParams {
    topic_mode?: boolean;
    topic_boundaries?: number[];
    model_family: string;
    model: string;
    model_cache_only: boolean;
    model_dir?: string;
    device: string;
    device_index: number;
    batch_size: number;
    compute_type: string;
    threads: number;
    output_format: string;
    verbose: boolean;
    task: string;
    language?: string;
    align_model?: string;
    interpolate_method: string;
    no_align: boolean;
    return_char_alignments: boolean;
    vad_method: string;
    vad_onset: number;
    vad_offset: number;
    chunk_size: number;
    qwen_merge_vad_seconds: number;
    qwen_chunk_manager: boolean;
    diarize: boolean;
    min_speakers?: number;
    max_speakers?: number;
    diarize_model: string;
    speaker_embeddings: boolean;
    temperature: number;
    best_of: number;
    beam_size: number;
    patience: number;
    length_penalty: number;
    suppress_tokens?: string;
    suppress_numerals: boolean;
    initial_prompt?: string;
    condition_on_previous_text: boolean;
    fp16: boolean;
    temperature_increment_on_fallback: number;
    compression_ratio_threshold: number;
    logprob_threshold: number;
    no_speech_threshold: number;
    max_line_width?: number;
    max_line_count?: number;
    highlight_words: boolean;
    segment_resolution: string;
    hf_token?: string;
    print_progress: boolean;
    attention_context_left: number;
    attention_context_right: number;
    is_multi_track_enabled: boolean;
    api_key?: string;
}
interface TranscriptionConfigDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onStartTranscription: (params: WhisperXParams & {
        profileName?: string;
        profileDescription?: string;
    }) => void;
    loading?: boolean;
    isProfileMode?: boolean;
    initialParams?: Partial<WhisperXParams>;
    initialName?: string;
    initialDescription?: string;
    isMultiTrack?: boolean;
    title?: string;
}
const DEFAULT_PARAMS: WhisperXParams = {
    model_family: "funasr",
    model: "Qwen/Qwen3-ASR-1.7B",
    model_cache_only: false,
    device: "cuda",
    device_index: 0,
    batch_size: 8,
    compute_type: "float16",
    threads: 0,
    output_format: "all",
    verbose: true,
    task: "transcribe",
    language: undefined,
    interpolate_method: "nearest",
    no_align: false,
    return_char_alignments: false,
    vad_method: "pyannote",
    vad_onset: 0.5,
    vad_offset: 0.363,
    chunk_size: 30,
    qwen_merge_vad_seconds: 0,
    qwen_chunk_manager: true,
    diarize: true,
    diarize_model: "nvidia_sortformer",
    speaker_embeddings: false,
    temperature: 0,
    best_of: 5,
    beam_size: 5,
    patience: 1.0,
    length_penalty: 1.0,
    suppress_numerals: false,
    condition_on_previous_text: false,
    fp16: true,
    temperature_increment_on_fallback: 0.2,
    compression_ratio_threshold: 2.4,
    logprob_threshold: -1.0,
    no_speech_threshold: 0.6,
    highlight_words: false,
    segment_resolution: "sentence",
    print_progress: false,
    attention_context_left: 256,
    attention_context_right: 256,
    is_multi_track_enabled: false,
    api_key: "",
};
const WHISPER_MODELS = [
    "tiny", "tiny.en", "base", "base.en", "small", "small.en",
    "medium", "medium.en", "large", "large-v1", "large-v2", "large-v3"
];
const LANGUAGES = [
    { value: "auto", label: "Auto-detect" },
    { value: "en", label: "English" },
    { value: "zh", label: "Chinese" },
    { value: "de", label: "German" },
    { value: "es", label: "Spanish" },
    { value: "ru", label: "Russian" },
    { value: "ko", label: "Korean" },
    { value: "fr", label: "French" },
    { value: "ja", label: "Japanese" },
    { value: "pt", label: "Portuguese" },
    { value: "tr", label: "Turkish" },
    { value: "pl", label: "Polish" },
    { value: "nl", label: "Dutch" },
    { value: "ar", label: "Arabic" },
    { value: "sv", label: "Swedish" },
    { value: "it", label: "Italian" },
    { value: "id", label: "Indonesian" },
    { value: "hi", label: "Hindi" },
    { value: "fi", label: "Finnish" },
    { value: "vi", label: "Vietnamese" },
    { value: "he", label: "Hebrew" },
    { value: "uk", label: "Ukrainian" },
    { value: "el", label: "Greek" },
];
const CANARY_LANGUAGES = [
    { value: "en", label: "English" },
    { value: "de", label: "German" },
    { value: "es", label: "Spanish" },
    { value: "fr", label: "French" },
];
const PARAM_DESCRIPTIONS = {
    model: "Size of the Whisper model. Larger = more accurate but slower.",
    language: translateUI("Source language. Auto-detect works for most cases."),
    task: translateUI("Transcribe in original language or translate to English."),
    device: "CPU (universal), GPU (faster, CUDA required), or AUTO.",
    compute_type: "Float16 (faster), Float32 (accurate), Int8 (fastest).",
    batch_size: "Segments processed at once. Higher = faster but more memory.",
    diarize: "Identify and separate different speakers.",
    diarize_model: "Nemotron-3 (up to 8 speakers, default), Sortformer 4spk-v2 (up to 4), or Pyannote (needs HF access). NVIDIA models detect speakers automatically; min/max inputs do not force their fixed capacity.",
    temperature: "0 = deterministic, higher = more creative.",
    beam_size: "Search beams. Higher = better quality but slower.",
    vad_method: "Voice detection: Pyannote (accurate) or Silero (fast).",
    initial_prompt: "Context text to guide transcription style.",
    hf_token: "Required for Pyannote diarization models.",
};
// ============================================================================
// Styled Input/Select Components 
// ============================================================================
const inputClassName = `
  h-11 bg-[var(--bg-main)] border border-[var(--border-subtle)] rounded-xl
  text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]
  focus:border-[var(--brand-solid)] focus:ring-2 focus:ring-[var(--brand-solid)]/20
  transition-all duration-200
  [color-scheme:light] dark:[color-scheme:dark]
`;
const selectTriggerClassName = `
  h-11 bg-[var(--bg-main)] border border-[var(--border-subtle)] rounded-xl
  text-[var(--text-primary)] shadow-none
  focus:border-[var(--brand-solid)] focus:ring-2 focus:ring-[var(--brand-solid)]/20
`;
const selectContentClassName = `
  bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl
`;
const selectItemClassName = `
  text-[var(--text-primary)] rounded-lg mx-1 cursor-pointer
  focus:bg-[var(--brand-light)] focus:text-[var(--brand-solid)]
`;
// ============================================================================
// Main Component
// ============================================================================
export const TranscriptionConfigDialog = memo(function TranscriptionConfigDialog({ open, onOpenChange, onStartTranscription, loading = false, isProfileMode = false, initialParams, initialName = "", initialDescription = "", isMultiTrack = false, title, }: TranscriptionConfigDialogProps) {
    const [params, setParams] = useState<WhisperXParams>(DEFAULT_PARAMS);
    const [topicTimes, setTopicTimes] = useState("");
    const [topicError, setTopicError] = useState("");
    const [profileName, setProfileName] = useState("");
    const [profileDescription, setProfileDescription] = useState("");
    // OpenAI validation state
    const [isValidating, setIsValidating] = useState(false);
    const [validationStatus, setValidationStatus] = useState<'idle' | 'valid' | 'invalid'>('idle');
    const [validationMessage, setValidationMessage] = useState("");
    const { getAuthHeaders } = useAuth();
    const [availableModels, setAvailableModels] = useState<string[]>(["whisper-1"]);
    // Reset when dialog opens
    useEffect(() => {
        if (open) {
            const baseParams = { ...DEFAULT_PARAMS, ...initialParams };
            const effectiveParams = initialParams ? baseParams : (isMultiTrack
                ? { ...DEFAULT_PARAMS, model_family: 'whisper', model: 'small', qwen_chunk_manager: false }
                : DEFAULT_PARAMS);
            setParams({
                ...effectiveParams,
                is_multi_track_enabled: isMultiTrack,
                qwen_chunk_manager: isMultiTrack ? false : effectiveParams.qwen_chunk_manager,
                diarize: isMultiTrack ? false : effectiveParams.diarize
            });
            setTopicTimes((baseParams.topic_boundaries || []).map(formatTopicTime).join(", "));
            setTopicError("");
            setProfileName(initialName);
            setProfileDescription(initialDescription);
        }
    }, [open, initialParams, initialName, initialDescription, isMultiTrack]);
    const updateParam = <K extends keyof WhisperXParams>(key: K, value: WhisperXParams[K]) => {
        setParams(prev => {
            const newParams = { ...prev, [key]: value };
            return newParams;
        });
    };
    const validateAPIKey = async () => {
        setIsValidating(true);
        setValidationStatus('idle');
        try {
            const response = await fetch('/api/v1/config/openai/validate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({ api_key: params.api_key }),
            });
            const data = await response.json();
            if (response.ok && data.valid) {
                setValidationStatus('valid');
                setAvailableModels(data.models || ["whisper-1"]);
                setValidationMessage("API key validated");
            }
            else {
                setValidationStatus('invalid');
                setValidationMessage(data.error || "Invalid API key");
            }
        }
        catch {
            setValidationStatus('invalid');
            setValidationMessage("Validation failed");
        }
        finally {
            setIsValidating(false);
        }
    };
    const handleSubmit = () => {
        let payload = params;
        if (params.topic_mode) {
            try {
                payload = { ...params, topic_boundaries: parseTopicTimes(topicTimes) };
            }
            catch (error) {
                setTopicError(error instanceof Error ? translateUI(error.message) : translateUI("\u5206\u754C\u65F6\u95F4\u65E0\u6548"));
                return;
            }
            if (!params.diarize || params.diarize_model !== "nvidia_sortformer") {
                setTopicError(translateUI("\u957F\u97F3\u9891\u6A21\u5F0F\u9700\u8981\u542F\u7528 Nemotron-3 \u8BF4\u8BDD\u4EBA\u533A\u5206"));
                return;
            }
        }
        if (isProfileMode) {
            onStartTranscription({ ...payload, profileName, profileDescription });
        }
        else {
            onStartTranscription(payload);
        }
    };
    const dialogTitle = title || (isProfileMode
        ? (initialName ? `Edit "${initialName}"` : "New Transcription Profile")
        : translateUI("Transcription Settings"));
    return (<Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-full sm:max-w-2xl w-[calc(100vw-1rem)] max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-2xl" style={{ boxShadow: 'var(--shadow-float)' }}>
                {/* Header */}
                <DialogHeader className="px-6 pt-6 pb-4 border-b border-[var(--border-subtle)]">
                    <DialogTitle className="text-xl font-semibold text-[var(--text-primary)]">
                        {dialogTitle}
                    </DialogTitle>
                    <DialogDescription className="text-[var(--text-secondary)] text-sm mt-1">
                        {isProfileMode
            ? "Configure and save your transcription settings."
            : "Choose a model and configure transcription parameters."}
                    </DialogDescription>
                </DialogHeader>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">

                    {/* Profile Name/Description (if profile mode) */}
                    {isProfileMode && (<div className="p-4 bg-[var(--bg-main)] rounded-xl border border-[var(--border-subtle)] space-y-4">
                            <FormField label={translateUI("Profile Name")} htmlFor="profileName">
                                <Input id="profileName" value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder={translateUI("My transcription profile")} className={inputClassName} required/>
                            </FormField>
                            <FormField label={translateUI("Description")} htmlFor="profileDesc" optional>
                                <Textarea id="profileDesc" value={profileDescription} onChange={(e) => setProfileDescription(e.target.value)} placeholder={translateUI("Describe this profile...")} className={`${inputClassName} resize-none min-h-[80px]`} rows={2}/>
                            </FormField>
                        </div>)}

                    {params.topic_mode && <div className="space-y-2 rounded-lg border p-4">
                        <Label htmlFor="config-topic-cuts">{translateUI("\u957F\u97F3\u9891 \u00B7 Topic \u5206\u754C\u65F6\u95F4")}</Label>
                        <Input id="config-topic-cuts" value={topicTimes} onChange={e => setTopicTimes(e.target.value)} placeholder="43:00"/>
                        <p className="text-sm text-muted-foreground">{translateUI("\u5404 topic \u72EC\u7ACB\u8BC6\u522B\u4EBA\uFF1B\u65F6\u95F4\u683C\u5F0F MM:SS \u6216 HH:MM:SS\uFF0C\u591A\u4E2A\u65F6\u95F4\u7528\u9017\u53F7\u5206\u9694\u3002")}</p>
                        {topicError && <p role="alert" className="text-sm text-red-600">{topicError}</p>}
                    </div>}

                    {/* Model Family Selection */}
                    <FormField label={translateUI("Model Family")} description={translateUI("Choose the AI model for transcription. Each has different capabilities and requirements.")}>
                        <Select value={params.model_family} onValueChange={(v) => setParams(prev => ({
            ...prev,
            model_family: v,
            model: v === 'funasr' ? 'Qwen/Qwen3-ASR-1.7B' : v === 'whisper' ? 'small' : prev.model,
            language: v === 'funasr' ? undefined : prev.language,
            device: v === 'funasr' ? 'cuda' : prev.device,
            diarize: v === 'funasr' ? !isMultiTrack : prev.diarize,
            diarize_model: v === 'funasr' ? preferredNvidiaDiarization(prev.diarize_model) : prev.diarize_model,
            qwen_merge_vad_seconds: 0,
            qwen_chunk_manager: v === 'funasr' && !isMultiTrack,
        }))}>
                            <SelectTrigger className={selectTriggerClassName}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className={selectContentClassName}>
                                <SelectItem value="whisper" className={selectItemClassName}>
                                    Whisper
                                </SelectItem>
                                <SelectItem value="funasr" className={selectItemClassName}>{translateUI("FunASR\uFF08\u4E2D\u6587\u4F1A\u8BAE\uFF09")}</SelectItem>
                                <SelectItem value="nvidia_parakeet" className={selectItemClassName}>
                                    NVIDIA Parakeet
                                </SelectItem>
                                <SelectItem value="nvidia_canary" className={selectItemClassName}>
                                    NVIDIA Canary
                                </SelectItem>
                                <SelectItem value="openai" className={selectItemClassName}>
                                    OpenAI
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </FormField>

                    {/* Multi-track notice */}
                    {isMultiTrack && (<InfoBanner variant="info" title={translateUI("Multi-track Audio Detected")}>{translateUI("Each audio track will be transcribed separately. Speaker diarization is disabled.")}</InfoBanner>)}

                    {/* Model-Specific Configuration */}
                    {params.model_family === "whisper" && (<WhisperConfig params={params} updateParam={updateParam} isMultiTrack={isMultiTrack}/>)}

                    {params.model_family === "funasr" && (<FunASRConfig params={params} updateParam={updateParam} isMultiTrack={isMultiTrack}/>)}

                    {params.model_family === "nvidia_parakeet" && (<ParakeetConfig params={params} updateParam={updateParam} isMultiTrack={isMultiTrack}/>)}

                    {params.model_family === "nvidia_canary" && (<CanaryConfig params={params} updateParam={updateParam} isMultiTrack={isMultiTrack}/>)}

                    {params.model_family === "openai" && (<OpenAIConfig params={params} updateParam={updateParam} isValidating={isValidating} validationStatus={validationStatus} validationMessage={validationMessage} availableModels={availableModels} onValidate={validateAPIKey}/>)}
                </div>

                {/* Footer */}
                <DialogFooter className="px-6 py-4 border-t border-[var(--border-subtle)] gap-3 sm:gap-2">
                    <Button variant="ghost" onClick={() => onOpenChange(false)} className="rounded-xl text-[var(--text-secondary)] hover:bg-[var(--bg-main)] cursor-pointer">{translateUI("Cancel")}</Button>
                    <Button onClick={handleSubmit} disabled={loading || (isProfileMode && !profileName.trim())} className="rounded-xl text-white cursor-pointer bg-gradient-to-r from-[#FFAB40] to-[#FF3D00] hover:opacity-90 active:scale-[0.98] transition-all shadow-lg shadow-orange-500/20">
                        {loading ? (<>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin"/>{translateUI("Starting...")}</>) : (isProfileMode ? translateUI("Save Profile") : translateUI("Start Transcription"))}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>);
});
// ============================================================================
// Model-Specific Configuration Components
// ============================================================================
interface ConfigProps {
    params: WhisperXParams;
    updateParam: <K extends keyof WhisperXParams>(key: K, value: WhisperXParams[K]) => void;
    isMultiTrack?: boolean;
}
function WhisperConfig({ params, updateParam, isMultiTrack }: ConfigProps) {
    useInterfaceLanguage();
    return (<div className="space-y-6">
            {/* Essential Settings */}
            <Section title={translateUI("Model Settings")}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField label={translateUI("Model Size")} description={PARAM_DESCRIPTIONS.model}>
                        <Select value={params.model} onValueChange={(v) => updateParam('model', v)}>
                            <SelectTrigger className={selectTriggerClassName}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className={selectContentClassName}>
                                {WHISPER_MODELS.map((m) => (<SelectItem key={m} value={m} className={selectItemClassName}>{m}</SelectItem>))}
                            </SelectContent>
                        </Select>
                    </FormField>

                    <FormField label={translateUI("Language")} description={PARAM_DESCRIPTIONS.language}>
                        <Select value={params.language || "auto"} onValueChange={(v) => updateParam('language', v === "auto" ? undefined : v)}>
                            <SelectTrigger className={selectTriggerClassName}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className={selectContentClassName}>
                                {LANGUAGES.map((l) => (<SelectItem key={l.value} value={l.value} className={selectItemClassName}>{translateUI(l.label)}</SelectItem>))}
                            </SelectContent>
                        </Select>
                    </FormField>

                    <FormField label={translateUI("Task")} description={PARAM_DESCRIPTIONS.task}>
                        <Select value={params.task} onValueChange={(v) => updateParam('task', v)}>
                            <SelectTrigger className={selectTriggerClassName}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className={selectContentClassName}>
                                <SelectItem value="transcribe" className={selectItemClassName}>{translateUI("Transcribe")}</SelectItem>
                                <SelectItem value="translate" className={selectItemClassName}>{translateUI("Translate to English")}</SelectItem>
                            </SelectContent>
                        </Select>
                    </FormField>

                    <FormField label={translateUI("Device")} description={PARAM_DESCRIPTIONS.device}>
                        <Select value={params.device} onValueChange={(v) => updateParam('device', v)}>
                            <SelectTrigger className={selectTriggerClassName}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className={selectContentClassName}>
                                <SelectItem value="cpu" className={selectItemClassName}>CPU</SelectItem>
                                <SelectItem value="cuda" className={selectItemClassName}>GPU (CUDA)</SelectItem>
                            </SelectContent>
                        </Select>
                    </FormField>
                </div>
            </Section>

            {/* Speaker Diarization */}
            {!isMultiTrack && (<Section title={translateUI("Speaker Diarization")} description={translateUI("Identify and separate different speakers in the audio")}>
                    <div className="space-y-4">
                        <div className="flex items-center gap-3">
                            <Switch id="diarize" checked={params.diarize} onCheckedChange={(v) => updateParam('diarize', v)}/>
                            <label htmlFor="diarize" className="text-sm text-[var(--text-primary)] cursor-pointer">{translateUI("Enable speaker identification")}</label>
                        </div>

                        {params.diarize && (<div className="p-4 bg-[var(--bg-main)] rounded-xl border border-[var(--border-subtle)] space-y-4">
                                <FormField label={translateUI("Diarization Model")} description={PARAM_DESCRIPTIONS.diarize_model}>
                                    <Select value={params.diarize_model} onValueChange={(v) => updateParam('diarize_model', v)}>
                                        <SelectTrigger className={selectTriggerClassName}>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className={selectContentClassName}>
                                            {NVIDIA_DIARIZATION_OPTIONS.map(option => <SelectItem key={option.value} value={option.value} className={selectItemClassName}>{translateUI(option.label)}</SelectItem>)}
                                            <SelectItem value="pyannote" className={selectItemClassName}>{translateUI("Pyannote (requires Hugging Face access)")}</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </FormField>
                                <div className="grid grid-cols-2 gap-4">
                                    <FormField label={translateUI("Min Speakers")} optional>
                                        <Input disabled={isNvidiaDiarizationModel(params.diarize_model)} type="number" min={1} max={20} placeholder={translateUI("Auto")} value={params.min_speakers || ""} onChange={(e) => updateParam('min_speakers', e.target.value ? parseInt(e.target.value) : undefined)} className={inputClassName}/>
                                    </FormField>
                                    <FormField label={translateUI("Max Speakers")} optional>
                                        <Input disabled={isNvidiaDiarizationModel(params.diarize_model)} type="number" min={1} max={20} placeholder={translateUI("Auto")} value={params.max_speakers || ""} onChange={(e) => updateParam('max_speakers', e.target.value ? parseInt(e.target.value) : undefined)} className={inputClassName}/>
                                    </FormField>
                                </div>

                                {params.diarize_model === "pyannote" && (<FormField label={translateUI("Hugging Face Token")} description={PARAM_DESCRIPTIONS.hf_token}>
                                        <Input type="password" placeholder="hf_..." value={params.hf_token || ""} onChange={(e) => updateParam('hf_token', e.target.value || undefined)} className={inputClassName}/>
                                    </FormField>)}
                            </div>)}
                    </div>
                </Section>)}

            {/* Advanced Settings (Accordion) */}
            <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="advanced" className="border border-[var(--border-subtle)] rounded-xl px-4">
                    <AccordionTrigger className="text-sm font-medium text-[var(--text-primary)] hover:no-underline py-4">{translateUI("Advanced Settings")}</AccordionTrigger>
                    <AccordionContent className="pb-4 space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <FormField label={translateUI("Compute Type")} description={PARAM_DESCRIPTIONS.compute_type}>
                                <Select value={params.compute_type} onValueChange={(v) => updateParam('compute_type', v)}>
                                    <SelectTrigger className={selectTriggerClassName}>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className={selectContentClassName}>
                                        <SelectItem value="float32" className={selectItemClassName}>{translateUI("Float32 (Accurate)")}</SelectItem>
                                        <SelectItem value="float16" className={selectItemClassName}>{translateUI("Float16 (Fast)")}</SelectItem>
                                        <SelectItem value="int8" className={selectItemClassName}>{translateUI("Int8 (Fastest)")}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </FormField>

                            <FormField label={translateUI("Batch Size")} description={PARAM_DESCRIPTIONS.batch_size}>
                                <Input type="number" min={1} max={64} value={params.batch_size} onChange={(e) => updateParam('batch_size', parseInt(e.target.value) || 8)} className={inputClassName}/>
                            </FormField>

                            <FormField label={translateUI("Beam Size")} description={PARAM_DESCRIPTIONS.beam_size}>
                                <Input type="number" min={1} max={10} value={params.beam_size} onChange={(e) => updateParam('beam_size', parseInt(e.target.value) || 5)} className={inputClassName}/>
                            </FormField>

                            <FormField label={translateUI("Temperature")} description={PARAM_DESCRIPTIONS.temperature}>
                                <Input type="number" min={0} max={1} step={0.1} value={params.temperature} onChange={(e) => updateParam('temperature', parseFloat(e.target.value) || 0)} className={inputClassName}/>
                            </FormField>
                        </div>

                        <FormField label={translateUI("Initial Prompt")} description={PARAM_DESCRIPTIONS.initial_prompt} optional>
                            <Textarea placeholder={translateUI("Optional context to guide transcription...")} value={params.initial_prompt || ""} onChange={(e) => updateParam('initial_prompt', e.target.value || undefined)} className={`${inputClassName} resize-none min-h-[80px]`} rows={2}/>
                        </FormField>

                        <div className="flex items-center gap-3">
                            <Switch id="suppress_numerals" checked={params.suppress_numerals} onCheckedChange={(v) => updateParam('suppress_numerals', v)}/>
                            <label htmlFor="suppress_numerals" className="text-sm text-[var(--text-primary)] cursor-pointer">{translateUI("Suppress numerals (write numbers as words)")}</label>
                        </div>

                        {/* Alignment Settings */}
                        <div className="pt-2 border-t border-[var(--border-subtle)] space-y-4">
                            <div className="flex items-center gap-3">
                                <Switch id="no_align" checked={params.no_align} onCheckedChange={(v) => updateParam('no_align', v)}/>
                                <label htmlFor="no_align" className="text-sm text-[var(--text-primary)] cursor-pointer">{translateUI("Skip word alignment (faster, less precise timestamps)")}</label>
                            </div>

                            {!params.no_align && (<FormField label={translateUI("Custom Alignment Model")} description={translateUI("WhisperX-compatible alignment model (e.g., KBLab/wav2vec2-large-voxrex-swedish). Leave empty for default.")} optional>
                                    <Input placeholder={translateUI("model/path or HuggingFace ID")} value={params.align_model || ""} onChange={(e) => updateParam('align_model', e.target.value || undefined)} className={inputClassName}/>
                                </FormField>)}
                        </div>
                    </AccordionContent>
                </AccordionItem>
            </Accordion>
        </div>);
}
function FunASRConfig({ params, updateParam, isMultiTrack }: ConfigProps) {
    useInterfaceLanguage();
    return (<div className="space-y-6">
            <Section title={translateUI("\u4E2D\u6587\u8F6C\u5199")} description={translateUI("\u9ED8\u8BA4\u4F7F\u7528 Qwen3-ASR + Sortformer + Chunk Manager\uFF1B\u4E5F\u53EF\u9009\u62E9\u5176\u4ED6\u6A21\u578B")}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField label={translateUI("\u6A21\u578B")}>
                        <Select value={params.model === 'iic/SenseVoiceSmall' || params.model === 'Qwen/Qwen3-ASR-1.7B' ? params.model : 'paraformer-zh'} onValueChange={(v) => {
            updateParam('model', v);
            updateParam('language', v === 'Qwen/Qwen3-ASR-1.7B' ? undefined : 'zh');
            updateParam('qwen_merge_vad_seconds', 0);
            updateParam('qwen_chunk_manager', v === 'Qwen/Qwen3-ASR-1.7B' && !isMultiTrack);
            if (v === 'Qwen/Qwen3-ASR-1.7B') {
                updateParam('device', 'cuda');
                updateParam('diarize', !isMultiTrack);
                updateParam('diarize_model', preferredNvidiaDiarization(params.diarize_model));
            }
            if (v === 'iic/SenseVoiceSmall' && params.diarize_model === 'funasr_campp') {
                updateParam('diarize_model', 'nvidia_sortformer');
            }
        }}>
                            <SelectTrigger className={selectTriggerClassName}><SelectValue /></SelectTrigger>
                            <SelectContent className={selectContentClassName}>
                                <SelectItem value="paraformer-zh" className={selectItemClassName}>Paraformer-zh</SelectItem>
                                <SelectItem value="iic/SenseVoiceSmall" className={selectItemClassName}>{translateUI("SenseVoiceSmall\uFF08\u8BD5\u9A8C\uFF09")}</SelectItem>
                                <SelectItem value="Qwen/Qwen3-ASR-1.7B" className={selectItemClassName}>{translateUI("Qwen3-ASR-1.7B\uFF08\u63A8\u8350\uFF09")}</SelectItem>
                            </SelectContent>
                        </Select>
                    </FormField>
                    <FormField label={translateUI("Audio language")} description={translateUI("Choose the spoken language. This is independent of the interface language. Timestamp alignment supports the listed languages.")}>
                        {params.model === 'Qwen/Qwen3-ASR-1.7B' ? (<Select value={params.language || "auto"} onValueChange={v => updateParam('language', v === 'auto' ? undefined : v)}>
                                <SelectTrigger className={selectTriggerClassName}><SelectValue /></SelectTrigger>
                                <SelectContent className={selectContentClassName}>
                                    {[['auto', translateUI("Auto-detect (Qwen)")], ['zh', translateUI("Chinese")], ['en', translateUI("English")], ['yue', translateUI("Cantonese")], ['fr', translateUI("French")], ['de', translateUI("German")], ['it', translateUI("Italian")], ['ja', translateUI("Japanese")], ['ko', translateUI("Korean")], ['pt', translateUI("Portuguese")], ['ru', translateUI("Russian")], ['es', translateUI("Spanish")]].map(([value, label]) => <SelectItem key={value} value={value} className={selectItemClassName}>{label}</SelectItem>)}
                                </SelectContent>
                            </Select>) : <p className="text-sm">{translateUI("Chinese (Paraformer / SenseVoice)")}</p>}
                    </FormField>
                    <FormField label={translateUI("\u8FD0\u884C\u8BBE\u5907")}>
                        <Select value={params.model === 'Qwen/Qwen3-ASR-1.7B' ? 'cuda' : params.device === "cpu" ? "cpu" : "cuda"} onValueChange={(v) => updateParam('device', v)}>
                            <SelectTrigger className={selectTriggerClassName}><SelectValue /></SelectTrigger>
                            <SelectContent className={selectContentClassName}>
                                <SelectItem value="cuda" className={selectItemClassName}>GPU (CUDA)</SelectItem>
                                {params.model !== 'Qwen/Qwen3-ASR-1.7B' && <SelectItem value="cpu" className={selectItemClassName}>CPU</SelectItem>}
                            </SelectContent>
                        </Select>
                    </FormField>
                </div>
                <p className="text-xs text-[var(--text-tertiary)]">{translateUI("Qwen3-ASR \u4F7F\u7528\u672C\u5730 ForcedAligner \u751F\u6210\u5B57\u7EA7\u65F6\u95F4\u6233\uFF0C\u4EC5\u652F\u6301 CUDA\uFF1B\u65B0\u5EFA\u5355\u8F68\u4EFB\u52A1\u9ED8\u8BA4\u542F\u7528\u8BF4\u8BDD\u4EBA\u611F\u77E5\u5207\u7247\u3002\u8BC6\u522B\u6587\u5B57\u548C\u8BF4\u8BDD\u4EBA\u4ECD\u5EFA\u8BAE\u5BF9\u7167\u539F\u97F3\u9891\u6838\u67E5\u3002")}</p>
                {params.model === 'Qwen/Qwen3-ASR-1.7B' && (<div className="space-y-4">
                        <div className="flex items-center gap-3">
                            <Switch id="qwen_chunk_manager" checked={params.qwen_chunk_manager} onCheckedChange={(enabled) => {
                updateParam('qwen_chunk_manager', enabled);
                if (enabled) {
                    updateParam('qwen_merge_vad_seconds', 0);
                    updateParam('diarize', true);
                    updateParam('diarize_model', preferredNvidiaDiarization(params.diarize_model));
                }
            }}/>
                            <label htmlFor="qwen_chunk_manager" className="text-sm text-[var(--text-primary)] cursor-pointer">{translateUI("\u8BF4\u8BDD\u4EBA\u611F\u77E5 Chunk Manager\uFF08\u6807\u51C6\u6D41\u7A0B\uFF09")}</label>
                        </div>
                        <p className="text-xs text-[var(--text-tertiary)]">{translateUI("\u5148\u8FD0\u884C Sortformer\uFF0C\u518D\u7EFC\u5408 VAD \u505C\u987F\u548C\u6301\u7EED\u6362\u4EBA\u751F\u6210\u7EA6 10\u201330 \u79D2\u7684 Qwen \u97F3\u9891\u5757\uFF1BForcedAligner \u5BF9\u9F50\u540E\u6309\u5206\u53E5\u591A\u6570\u5F52\u5C5E\u8BF4\u8BDD\u4EBA\u3002\u77ED\u63D2\u8BDD\u4E0D\u5F3A\u5236\u5207\u3002\u65B0\u4EFB\u52A1\u9ED8\u8BA4\u4F7F\u7528\u6B64\u6D41\u7A0B\u3002")}</p>
                        {!params.qwen_chunk_manager && (<FormField label={translateUI("\u65E7\u7248 VAD \u5408\u5E76\uFF08\u517C\u5BB9\uFF09")} description={translateUI("\u5173\u95ED\u6807\u51C6 Chunk Manager \u540E\u53EF\u4F7F\u7528\u65E7\u7248\u5408\u5E76\u6D41\u7A0B\uFF1B\u4EC5\u4F9B\u5BF9\u7167\u6216\u517C\u5BB9\u65E7\u914D\u7F6E\u3002")}>
                                <Select value={params.qwen_merge_vad_seconds === 15 ? '15' : '0'} onValueChange={(v) => updateParam('qwen_merge_vad_seconds', Number(v))}>
                                    <SelectTrigger className={selectTriggerClassName}><SelectValue /></SelectTrigger>
                                    <SelectContent className={selectContentClassName}>
                                        <SelectItem value="0" className={selectItemClassName}>{translateUI("\u4E0D\u5408\u5E76")}</SelectItem>
                                        <SelectItem value="15" className={selectItemClassName}>{translateUI("\u7EA6 15 \u79D2\u5408\u5E76\uFF08\u65E7\u7248\uFF09")}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </FormField>)}
                    </div>)}
            </Section>
            {!isMultiTrack && (<Section title={translateUI("\u8BF4\u8BDD\u4EBA\u533A\u5206")} description={translateUI("\u65B0\u7248 Nemotron \u6700\u591A 8 \u4EBA\uFF0C\u65E7\u7248 Sortformer \u6700\u591A 4 \u4EBA\uFF1B\u53EA\u8FD0\u884C\u6240\u9009\u6A21\u578B\uFF0C\u4E5F\u53EF\u9009\u62E9 FunASR \u81EA\u5E26 CAM++ \u6D41\u6C34\u7EBF")}>
                    <div className="flex items-center gap-3">
                        <Switch id="funasr_diarize" checked={params.diarize} disabled={params.qwen_chunk_manager} onCheckedChange={(v) => updateParam('diarize', v)}/>
                        <label htmlFor="funasr_diarize" className="text-sm text-[var(--text-primary)] cursor-pointer">{translateUI("\u542F\u7528\u8BF4\u8BDD\u4EBA\u533A\u5206")}</label>
                    </div>
                    {params.diarize && (<div className="mt-4 space-y-2">
                            <FormField label={translateUI("\u8BF4\u8BDD\u4EBA\u65B9\u6848")}>
                                <Select value={speakerSelection(params.diarize_model, params.qwen_chunk_manager, params.model !== 'iic/SenseVoiceSmall')} onValueChange={(v) => updateParam('diarize_model', v)}>
                                    <SelectTrigger className={selectTriggerClassName}><SelectValue /></SelectTrigger>
                                    <SelectContent className={selectContentClassName}>
                                        {NVIDIA_DIARIZATION_OPTIONS.map(option => <SelectItem key={option.value} value={option.value} className={selectItemClassName}>{translateUI(option.label)}</SelectItem>)}
                                        {params.model !== 'iic/SenseVoiceSmall' && !params.qwen_chunk_manager && (<SelectItem value="funasr_campp" className={selectItemClassName}>{translateUI("FunASR CAM++\uFF08\u8BD5\u9A8C\uFF0C\u5B98\u65B9\u6D41\u6C34\u7EBF\uFF09")}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </FormField>
                            <p className="text-xs text-[var(--text-tertiary)]">{translateUI("CAM++ \u4F7F\u7528 FunASR \u7684 VAD \u5206\u6BB5\u4E0E\u533F\u540D\u8BF4\u8BDD\u4EBA\u805A\u7C7B\uFF1B\u652F\u6301 Paraformer-zh \u548C Qwen3-ASR\u3002\u8BF4\u8BDD\u4EBA\u7F16\u53F7\u9700\u4EBA\u5DE5\u6838\u5BF9\u3002")}</p>
                        </div>)}
                </Section>)}
        </div>);
}
function ParakeetConfig({ params, updateParam, isMultiTrack }: ConfigProps) {
    useInterfaceLanguage();
    return (<div className="space-y-6">
            {/* Long-form Audio Settings */}
            <Section title={translateUI("Audio Context")} description={translateUI("Configure how much context the model uses for long audio files")}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-3">
                        <FormField label={translateUI("Left Context")}>
                            <Slider value={[params.attention_context_left]} onValueChange={(v) => updateParam('attention_context_left', v[0])} max={512} min={64} step={64} className="w-full"/>
                            <div className="flex justify-between text-xs text-[var(--text-tertiary)]">
                                <span>64</span>
                                <span className="font-medium text-[var(--text-primary)]">{params.attention_context_left}</span>
                                <span>512</span>
                            </div>
                        </FormField>
                    </div>

                    <div className="space-y-3">
                        <FormField label={translateUI("Right Context")}>
                            <Slider value={[params.attention_context_right]} onValueChange={(v) => updateParam('attention_context_right', v[0])} max={512} min={64} step={64} className="w-full"/>
                            <div className="flex justify-between text-xs text-[var(--text-tertiary)]">
                                <span>64</span>
                                <span className="font-medium text-[var(--text-primary)]">{params.attention_context_right}</span>
                                <span>512</span>
                            </div>
                        </FormField>
                    </div>
                </div>
            </Section>

            {/* Diarization for Parakeet */}
            {!isMultiTrack && (<Section title={translateUI("Speaker Diarization")}>
                    <div className="space-y-4">
                        <div className="flex items-center gap-3">
                            <Switch id="parakeet_diarize" checked={params.diarize} onCheckedChange={(v) => updateParam('diarize', v)}/>
                            <label htmlFor="parakeet_diarize" className="text-sm text-[var(--text-primary)] cursor-pointer">{translateUI("Enable speaker identification")}</label>
                        </div>

                        {params.diarize && (<div className="p-4 bg-[var(--bg-main)] rounded-xl border border-[var(--border-subtle)] space-y-4">
                                <FormField label={translateUI("Diarization Model")}>
                                    <Select value={params.diarize_model} onValueChange={(v) => updateParam('diarize_model', v)}>
                                        <SelectTrigger className={selectTriggerClassName}>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className={selectContentClassName}>
                                            <SelectItem value="pyannote" className={selectItemClassName}>Pyannote</SelectItem>
                                            {NVIDIA_DIARIZATION_OPTIONS.map(option => <SelectItem key={option.value} value={option.value} className={selectItemClassName}>{translateUI(option.label)}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </FormField>

                                <div className="grid grid-cols-2 gap-4">
                                    <FormField label={translateUI("Min Speakers")} optional>
                                        <Input disabled={isNvidiaDiarizationModel(params.diarize_model)} type="number" min={1} max={20} placeholder={translateUI("Auto")} value={params.min_speakers || ""} onChange={(e) => updateParam('min_speakers', e.target.value ? parseInt(e.target.value) : undefined)} className={inputClassName}/>
                                    </FormField>
                                    <FormField label={translateUI("Max Speakers")} optional>
                                        <Input disabled={isNvidiaDiarizationModel(params.diarize_model)} type="number" min={1} max={20} placeholder={translateUI("Auto")} value={params.max_speakers || ""} onChange={(e) => updateParam('max_speakers', e.target.value ? parseInt(e.target.value) : undefined)} className={inputClassName}/>
                                    </FormField>
                                </div>

                                {params.diarize_model === "pyannote" && (<FormField label={translateUI("Hugging Face Token")}>
                                        <Input type="password" placeholder="hf_..." value={params.hf_token || ""} onChange={(e) => updateParam('hf_token', e.target.value || undefined)} className={inputClassName}/>
                                    </FormField>)}
                            </div>)}
                    </div>
                </Section>)}
        </div>);
}
function CanaryConfig({ params, updateParam, isMultiTrack }: ConfigProps) {
    useInterfaceLanguage();
    return (<div className="space-y-6">
            <Section title={translateUI("Language Settings")}>
                <FormField label={translateUI("Source Language")}>
                    <Select value={params.language || "en"} onValueChange={(v) => updateParam('language', v)}>
                        <SelectTrigger className={selectTriggerClassName}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent className={selectContentClassName}>
                            {CANARY_LANGUAGES.map((l) => (<SelectItem key={l.value} value={l.value} className={selectItemClassName}>{translateUI(l.label)}</SelectItem>))}
                        </SelectContent>
                    </Select>
                </FormField>
            </Section>

            {/* Diarization for Canary */}
            {!isMultiTrack && (<Section title={translateUI("Speaker Diarization")}>
                    <div className="space-y-4">
                        <div className="flex items-center gap-3">
                            <Switch id="canary_diarize" checked={params.diarize} onCheckedChange={(v) => updateParam('diarize', v)}/>
                            <label htmlFor="canary_diarize" className="text-sm text-[var(--text-primary)] cursor-pointer">{translateUI("Enable speaker identification")}</label>
                        </div>

                        {params.diarize && (<div className="p-4 bg-[var(--bg-main)] rounded-xl border border-[var(--border-subtle)] space-y-4">
                                <FormField label={translateUI("Diarization Model")}>
                                    <Select value={params.diarize_model} onValueChange={(v) => updateParam('diarize_model', v)}>
                                        <SelectTrigger className={selectTriggerClassName}>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className={selectContentClassName}>
                                            <SelectItem value="pyannote" className={selectItemClassName}>Pyannote</SelectItem>
                                            {NVIDIA_DIARIZATION_OPTIONS.map(option => <SelectItem key={option.value} value={option.value} className={selectItemClassName}>{translateUI(option.label)}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </FormField>

                                <div className="grid grid-cols-2 gap-4">
                                    <FormField label={translateUI("Min Speakers")} optional>
                                        <Input disabled={isNvidiaDiarizationModel(params.diarize_model)} type="number" min={1} max={20} placeholder={translateUI("Auto")} value={params.min_speakers || ""} onChange={(e) => updateParam('min_speakers', e.target.value ? parseInt(e.target.value) : undefined)} className={inputClassName}/>
                                    </FormField>
                                    <FormField label={translateUI("Max Speakers")} optional>
                                        <Input disabled={isNvidiaDiarizationModel(params.diarize_model)} type="number" min={1} max={20} placeholder={translateUI("Auto")} value={params.max_speakers || ""} onChange={(e) => updateParam('max_speakers', e.target.value ? parseInt(e.target.value) : undefined)} className={inputClassName}/>
                                    </FormField>
                                </div>

                                {params.diarize_model === "pyannote" && (<FormField label={translateUI("Hugging Face Token")}>
                                        <Input type="password" placeholder="hf_..." value={params.hf_token || ""} onChange={(e) => updateParam('hf_token', e.target.value || undefined)} className={inputClassName}/>
                                    </FormField>)}
                            </div>)}
                    </div>
                </Section>)}
        </div>);
}
interface OpenAIConfigProps extends ConfigProps {
    isValidating: boolean;
    validationStatus: 'idle' | 'valid' | 'invalid';
    validationMessage: string;
    availableModels: string[];
    onValidate: () => void;
}
function OpenAIConfig({ params, updateParam, isValidating, validationStatus, validationMessage, availableModels, onValidate }: OpenAIConfigProps) {
    useInterfaceLanguage();
    return (<div className="space-y-6">
            <Section title={translateUI("API Configuration")}>
                <div className="space-y-4">
                    <FormField label={translateUI("OpenAI API Key")} description={translateUI("Your API key. Leave empty to use server default if configured.")}>
                        <div className="flex gap-2">
                            <Input type="password" placeholder="sk-..." value={params.api_key || ""} onChange={(e) => {
            updateParam('api_key', e.target.value);
        }} className={`${inputClassName} flex-1`}/>
                            <Button variant="outline" onClick={onValidate} disabled={isValidating} className="shrink-0 rounded-xl border-[var(--border-subtle)] cursor-pointer">
                                {isValidating ? <Loader2 className="h-4 w-4 animate-spin"/> : translateUI("Validate")}
                            </Button>
                        </div>
                        {validationStatus !== 'idle' && (<div className={`flex items-center gap-2 text-sm mt-2 ${validationStatus === 'valid' ? 'text-[var(--success-solid)]' : 'text-[var(--error)]'}`}>
                                {validationStatus === 'valid' ? <Check className="h-4 w-4"/> : <XCircle className="h-4 w-4"/>}
                                <span>{validationMessage}</span>
                            </div>)}
                    </FormField>

                    <FormField label={translateUI("Model")}>
                        <Select value={params.model || "whisper-1"} onValueChange={(v) => updateParam('model', v)}>
                            <SelectTrigger className={selectTriggerClassName}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className={selectContentClassName}>
                                {availableModels.map((m) => (<SelectItem key={m} value={m} className={selectItemClassName}>{m}</SelectItem>))}
                            </SelectContent>
                        </Select>
                    </FormField>

                    <FormField label={translateUI("Language")}>
                        <Select value={params.language || "auto"} onValueChange={(v) => updateParam('language', v === "auto" ? undefined : v)}>
                            <SelectTrigger className={selectTriggerClassName}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className={selectContentClassName}>
                                {LANGUAGES.map((l) => (<SelectItem key={l.value} value={l.value} className={selectItemClassName}>{translateUI(l.label)}</SelectItem>))}
                            </SelectContent>
                        </Select>
                    </FormField>
                </div>
            </Section>

            {params.model && params.model !== "whisper-1" && (<InfoBanner variant="warning" title={translateUI("Limited Features")}>{translateUI("Word-level timestamps are only supported by whisper-1. Synchronized playback won't be available.")}</InfoBanner>)}
        </div>);
}
