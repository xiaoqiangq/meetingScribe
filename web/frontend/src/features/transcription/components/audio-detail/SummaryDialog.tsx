import { t as translateUI } from "@/i18n";
import { getLocale } from "@/i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, } from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useState, useEffect } from "react";
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import { useSummaryTemplates, useSummarizer, useExistingSummary, useSummaryHistory } from "@/features/transcription/hooks/useTranscriptionSummary";
import { useTranscript, useAudioDetail } from "@/features/transcription/hooks/useAudioDetail";
import { useSpeakerMappings } from "@/features/transcription/hooks/useTranscriptionSpeakers";
import { formatSummaryTranscript } from "./summaryTranscript";
import { cleanSummaryAnnotations } from "./summaryVersions";
import { Sparkles, Download, Copy, RefreshCw, ChevronDown, FileText } from "lucide-react";
interface SummaryDialogProps {
    audioId: string;
    isOpen: boolean;
    onClose: (open: boolean) => void;
    llmReady: boolean | null;
}
export function SummaryDialog({ audioId, isOpen, onClose, llmReady }: SummaryDialogProps) {
    const { toast } = useToast();
    const { data: templates = [], isLoading: templatesLoading } = useSummaryTemplates();
    const { data: existingSummary, isLoading: summaryLoading } = useExistingSummary(audioId, isOpen);
    const { data: history = [], isLoading: historyLoading, error: historyError } = useSummaryHistory(audioId, isOpen);
    const { data: transcript } = useTranscript(audioId, true);
    const { data: audioFile } = useAudioDetail(audioId);
    const { refetch: refreshSpeakerMappings } = useSpeakerMappings(audioId, isOpen);
    // Hooks
    const { generateSummary, isStreaming, streamContent, error } = useSummarizer(audioId);
    // State
    const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
    const [tplPopoverOpen, setTplPopoverOpen] = useState(false);
    const [showOutput, setShowOutput] = useState(false);
    const [isPreparing, setIsPreparing] = useState(false);
    const [summaryVersion, setSummaryVersion] = useState<'annotated' | 'clean'>('annotated');
    const [selectedHistoryId, setSelectedHistoryId] = useState('');
    const selectedHistory = history.find(entry => entry.id === selectedHistoryId);
    const rawContent = selectedHistory?.content ?? (streamContent || existingSummary?.content || history[0]?.content || '');
    const displayedError = selectedHistory ? null : error;
    const displayedContent = summaryVersion === 'clean' ? cleanSummaryAnnotations(rawContent) : rawContent;
    const selectedTemplate = templates.find(t => t.id === selectedTemplateId);
    // Auto-show existing summary if available and not streaming
    // Wait for loading to complete to prevent blank display
    useEffect(() => {
        if (isOpen && !summaryLoading && (streamContent || existingSummary?.content || history.length) && !isStreaming) {
            setShowOutput(true);
        }
    }, [isOpen, existingSummary, summaryLoading, isStreaming, streamContent, history.length]);
    // Reset state when dialog closes
    useEffect(() => {
        if (!isOpen) {
            setShowOutput(false);
            setSelectedTemplateId("");
        }
    }, [isOpen]);
    const handleStartSummary = async () => {
        if (!selectedTemplate || !transcript || isPreparing || isStreaming)
            return;
        setIsPreparing(true);
        try {
            // Read saved names again at click time, including recent confirmations.
            const mappings = await refreshSpeakerMappings();
            if (mappings.isError || !mappings.data)
                throw new Error(translateUI("\u65E0\u6CD5\u8BFB\u53D6\u5DF2\u4FDD\u5B58\u7684\u89D2\u8272\u540D\u79F0\uFF0C\u8BF7\u91CD\u8BD5\u3002"));
            const transcriptText = formatSummaryTranscript(transcript, mappings.data);
            setSelectedHistoryId('');
            setShowOutput(true);
            await generateSummary(selectedTemplate.id, selectedTemplate.model, selectedTemplate.prompt, transcriptText);
        }
        catch (error) {
            toast({ title: error instanceof Error ? translateUI(error.message) : translateUI("\u51C6\u5907\u4F1A\u8BAE\u7EAA\u8981\u5931\u8D25") });
        }
        finally {
            setIsPreparing(false);
        }
    };
    const handleCopy = async () => {
        const content = displayedContent;
        if (content) {
            await navigator.clipboard.writeText(content);
            toast({ title: translateUI("Copied to clipboard") });
        }
    };
    const handleDownload = () => {
        const content = displayedContent;
        if (!content)
            return;
        const title = audioFile?.title || "summary";
        const historySuffix = selectedHistory ? `-${selectedHistory.id}` : '';
        const filename = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}-summary${historySuffix}-${summaryVersion}.md`;
        const blob = new Blob([content], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };
    // Handle close - prevent closing during streaming
    const handleOpenChange = (open: boolean) => {
        if (!open && (isStreaming || isPreparing)) {
            // Don't allow closing during streaming
            return;
        }
        onClose(open);
    };
    if (showOutput) {
        // Output View - Redesigned with Scriberr Design System
        return (<Dialog open={isOpen} onOpenChange={handleOpenChange}>
                <DialogContent className="w-[calc(100%-2rem)] max-w-4xl mx-auto bg-[var(--bg-card)] dark:bg-[#0A0A0A] border border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)] shadow-[0_2px_4px_rgba(0,0,0,0.04),0_24px_48px_rgba(0,0,0,0.08)] dark:shadow-[0_2px_4px_rgba(0,0,0,0.3),0_24px_48px_rgba(0,0,0,0.3)] p-0 rounded-2xl max-h-[85vh] overflow-hidden">
                    <DialogHeader className="p-5 pb-4 border-b border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)]">
                        <DialogTitle className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2">
                            <div className="h-9 w-9 rounded-full bg-gradient-to-br from-[#FFAB40] to-[#FF6D20] flex items-center justify-center shadow-md">
                                <Sparkles className="h-4 w-4 text-white"/>
                            </div>{translateUI("\u4F1A\u8BAE\u7EAA\u8981")}</DialogTitle>
                        <DialogDescription className="flex items-center gap-2 text-[var(--text-secondary)] mt-1">
                            {isStreaming ? (<>
                                    <span>{translateUI("Generating summary")}</span>
                                    <span className="flex gap-1">
                                        <span className="w-1.5 h-1.5 bg-[var(--brand-solid)] rounded-full animate-bounce" style={{ animationDelay: '0ms' }}/>
                                        <span className="w-1.5 h-1.5 bg-[var(--brand-solid)] rounded-full animate-bounce" style={{ animationDelay: '150ms' }}/>
                                        <span className="w-1.5 h-1.5 bg-[var(--brand-solid)] rounded-full animate-bounce" style={{ animationDelay: '300ms' }}/>
                                    </span>
                                </>) : (<span>{displayedError ? 'Generation failed' : 'Summary ready'}</span>)}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="p-5 pt-4">
                        <div className="mb-4 space-y-1.5">
                            <Label htmlFor="summary-history">{translateUI("\u5386\u53F2\u7EAA\u8981")}</Label>
                            <select id="summary-history" value={selectedHistoryId} onChange={event => setSelectedHistoryId(event.target.value)} disabled={isStreaming || isPreparing || historyLoading} className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)]">
                                <option value="">{translateUI("\u6700\u65B0\u751F\u6210\u7ED3\u679C")}</option>
                                {history.map(entry => <option key={entry.id} value={entry.id}>
                                    {entry.template_name || translateUI("\u6A21\u677F\u672A\u8BB0\u5F55/\u5DF2\u5220\u9664")} · {new Date(entry.created_at).toLocaleString(getLocale(), { timeZone: 'Asia/Shanghai', hour12: false })} · {entry.id.slice(0, 8)}
                                </option>)}
                            </select>
                            <p className="text-xs text-[var(--text-tertiary)]">{historyError ? translateUI("\u5386\u53F2\u7EAA\u8981\u8BFB\u53D6\u5931\u8D25\uFF0C\u8BF7\u5173\u95ED\u540E\u91CD\u8BD5\u3002") : (translateUI("\u5171 ") + history.length + translateUI(" \u4EFD\u5386\u53F2\u7EAA\u8981\uFF1B\u590D\u5236\u548C\u4E0B\u8F7D\u4F7F\u7528\u5F53\u524D\u9009\u4E2D\u7684\u7ED3\u679C\u3002"))}</p>
                        </div>
                        {/* Action buttons */}
                        <div className="flex flex-wrap items-center justify-end gap-2 mb-4">
                            <div className="mr-auto flex gap-1" role="group" aria-label={translateUI("\u4F1A\u8BAE\u7EAA\u8981\u7248\u672C")}>
                                <Button size="sm" variant={summaryVersion === 'annotated' ? 'default' : 'outline'} aria-pressed={summaryVersion === 'annotated'} onClick={() => setSummaryVersion('annotated')}>{translateUI("\u5E26\u6765\u6E90\u6807\u6CE8")}</Button>
                                <Button size="sm" variant={summaryVersion === 'clean' ? 'default' : 'outline'} aria-pressed={summaryVersion === 'clean'} onClick={() => setSummaryVersion('clean')}>{translateUI("\u6E05\u6D01\u7248")}</Button>
                            </div>
                            <Button variant="outline" size="sm" onClick={() => {
                setShowOutput(false);
                setSelectedTemplateId('');
            }} disabled={isStreaming} className="h-9 rounded-full border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)] hover:bg-[var(--bg-main)] transition-all">
                                <RefreshCw className="h-3.5 w-3.5"/>{translateUI("Regenerate")}</Button>
                            <Button variant="outline" size="sm" onClick={handleCopy} disabled={!rawContent} className="h-9 rounded-full border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)] hover:bg-[var(--bg-main)] transition-all">
                                <Copy className="h-3.5 w-3.5"/>{translateUI("Copy")}</Button>
                            <Button variant="outline" size="sm" onClick={handleDownload} disabled={!rawContent} className="h-9 rounded-full border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)] hover:bg-[var(--bg-main)] transition-all">
                                <Download className="h-3.5 w-3.5"/>{translateUI("Download")}</Button>
                        </div>

                        {/* Content area - no inner card, full width, reading font */}
                        <div className="min-h-[200px] max-h-[55vh] overflow-y-auto font-reading">
                            {displayedError ? (<p className="text-sm text-[var(--error)]">{displayedError}</p>) : isStreaming && !streamContent ? (
            /* Generating animation while waiting for first chunk */
            <div className="flex flex-col items-center justify-center py-12 text-[var(--text-tertiary)]">
                                    <div className="relative h-12 w-12 mb-4">
                                        <div className="absolute inset-0 rounded-full border-2 border-[var(--brand-solid)]/20"></div>
                                        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[var(--brand-solid)] animate-spin"></div>
                                        <Sparkles className="absolute inset-0 m-auto h-5 w-5 text-[var(--brand-solid)] animate-pulse"/>
                                    </div>
                                    <p className="text-sm font-medium">{translateUI("Generating summary...")}</p>
                                    <p className="text-xs mt-1">{translateUI("This may take a moment")}</p>
                                </div>) : (<div className="prose prose-stone dark:prose-invert max-w-none text-[#171717] dark:text-[#EDEDED] leading-relaxed">
                                    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeRaw as any, rehypeKatex as any, rehypeHighlight as any]} // eslint-disable-line @typescript-eslint/no-explicit-any
             components={{
                    p: ({ ...props }) => <p className="text-[#525252] dark:text-[#A3A3A3] leading-7 mb-4" {...props}/>,
                    h1: ({ ...props }) => <h1 className="text-[#171717] dark:text-[#EDEDED] font-bold text-2xl mt-6 mb-4" {...props}/>,
                    h2: ({ ...props }) => <h2 className="text-[#171717] dark:text-[#EDEDED] font-bold text-xl mt-6 mb-3" {...props}/>,
                    h3: ({ ...props }) => <h3 className="text-[#171717] dark:text-[#EDEDED] font-bold text-lg mt-5 mb-2" {...props}/>,
                    li: ({ ...props }) => <li className="pl-1 text-[#525252] dark:text-[#A3A3A3] mb-1" {...props}/>,
                    strong: ({ ...props }) => <strong className="text-[#171717] dark:text-[#EDEDED] font-bold" {...props}/>,
                    ul: ({ ...props }) => <ul className="list-disc pl-5 mb-4" {...props}/>,
                    ol: ({ ...props }) => <ol className="list-decimal pl-5 mb-4" {...props}/>,
                }}>
                                        {displayedContent}
                                    </ReactMarkdown>
                                    {isStreaming && (<span className="inline-block w-2 h-5 bg-[var(--brand-solid)] ml-0.5 animate-pulse align-middle"/>)}
                                </div>)}
                            {!displayedError && !rawContent && !isStreaming && (<p className="text-sm text-[var(--text-tertiary)] italic text-center py-8">{translateUI("No content to display.")}</p>)}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>);
    }
    // Template Selector View - Redesigned with Scriberr Design System
    return (<Dialog open={isOpen} onOpenChange={handleOpenChange}>
            <DialogContent className="w-[calc(100%-2rem)] max-w-lg mx-auto bg-[var(--bg-card)] dark:bg-[#0A0A0A] border border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)] shadow-[0_2px_4px_rgba(0,0,0,0.04),0_24px_48px_rgba(0,0,0,0.08)] dark:shadow-[0_2px_4px_rgba(0,0,0,0.3),0_24px_48px_rgba(0,0,0,0.3)] p-0 rounded-2xl overflow-hidden" onPointerDownOutside={(e) => {
            // Prevent closing when clicking inside popover
            if (tplPopoverOpen) {
                e.preventDefault();
            }
        }}>
                <DialogHeader className="p-5 pb-0">
                    <DialogTitle className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2">
                        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-[#FFAB40] to-[#FF6D20] flex items-center justify-center shadow-md">
                            <FileText className="h-4 w-4 text-white"/>
                        </div>{translateUI("\u4F1A\u8BAE\u7EAA\u8981")}</DialogTitle>
                    <DialogDescription className="text-[var(--text-tertiary)] mt-1">{translateUI("\u9009\u62E9\u6A21\u677F\uFF0C\u6309\u65F6\u95F4\u3001\u5DF2\u786E\u8BA4\u59D3\u540D\u548C\u53D1\u8A00\u5185\u5BB9\u751F\u6210\u4F1A\u8BAE\u7EAA\u8981\u3002\u672A\u547D\u540D\u89D2\u8272\u4FDD\u7559\u539F\u59CB\u6807\u7B7E\u3002")}</DialogDescription>
                </DialogHeader>

                <div className="p-5 space-y-5">
                    {llmReady === false && (<div className="p-4 bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 rounded-xl text-sm flex items-center gap-2">
                            <span className="h-2 w-2 bg-amber-500 rounded-full animate-pulse"/>{translateUI("LLM is not configured or active. Please check settings.")}</div>)}

                    <div className="space-y-2">
                        <Label className="text-sm font-medium text-[var(--text-secondary)]">{translateUI("Template")}</Label>
                        <Popover open={tplPopoverOpen} onOpenChange={setTplPopoverOpen} modal={true}>
                            <PopoverTrigger asChild>
                                <button className="w-full h-11 inline-flex justify-between items-center rounded-xl border border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)] bg-[var(--bg-main)] dark:bg-[#141414] px-4 text-sm text-[var(--text-primary)] hover:border-[var(--brand-solid)]/50 focus:ring-2 focus:ring-[var(--brand-solid)]/20 transition-all outline-none disabled:opacity-50 shadow-[0_2px_4px_rgba(0,0,0,0.04)]" aria-label={translateUI("Choose template")} disabled={!llmReady} type="button">
                                    <span className="truncate text-left">{selectedTemplate ? selectedTemplate.name : (templatesLoading ? translateUI("Loading...") : translateUI("Select a template"))}</span>
                                    <span className="flex items-center text-xs text-[var(--text-tertiary)] ml-2 shrink-0">
                                        {selectedTemplate?.model ? `(${selectedTemplate.model})` : ''}
                                        <ChevronDown className="ml-2 h-4 w-4 opacity-50"/>
                                    </span>
                                </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-1 bg-[var(--bg-card)] dark:bg-[#1F1F1F] border border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)] shadow-xl rounded-xl" onOpenAutoFocus={(e) => e.preventDefault()}>
                                <Command className="bg-transparent">
                                    <CommandInput placeholder={translateUI("Search templates...")} className="border-none focus:ring-0 h-10"/>
                                    <CommandList className="max-h-64 overflow-auto p-1">
                                        <CommandEmpty className="py-3 text-center text-xs text-[var(--text-tertiary)]">{templatesLoading ? translateUI("Loading...") : 'No templates found'}</CommandEmpty>
                                        <CommandGroup heading="Templates" className="text-[var(--text-tertiary)]">
                                            {templates.map(t => (<CommandItem key={t.id} value={t.name} onSelect={() => { setSelectedTemplateId(t.id); setTplPopoverOpen(false); }} className="rounded-lg py-2.5 px-3 aria-selected:bg-[var(--brand-solid)] aria-selected:text-white cursor-pointer transition-colors">
                                                    <div className="flex flex-col w-full">
                                                        <span className="text-sm font-medium">{t.name}</span>
                                                        <span className="text-xs opacity-70">{translateUI("Model:")}{t.model || '—'}</span>
                                                    </div>
                                                </CommandItem>))}
                                        </CommandGroup>
                                    </CommandList>
                                </Command>
                            </PopoverContent>
                        </Popover>

                        {!templatesLoading && templates.length === 0 && (<p className="text-xs text-[var(--text-tertiary)] pl-1">{translateUI("No templates found. Go to Settings \u2192 Summary to create one.")}</p>)}
                        {selectedTemplate && !selectedTemplate.model && (<p className="text-xs text-[var(--error)] pl-1">{translateUI("Selected template has no model configured.")}</p>)}
                    </div>
                </div>

                <div className="p-5 pt-0 flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
                    <Button variant="ghost" disabled={isPreparing} onClick={() => onClose(false)} className="h-11 px-6 rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-main)] w-full sm:w-auto">{translateUI("Cancel")}</Button>
                    <Button disabled={!selectedTemplateId || !selectedTemplate?.model || !llmReady || !transcript || isPreparing} onClick={handleStartSummary} className="h-11 px-6 bg-gradient-to-br from-[#FFAB40] to-[#FF3D00] text-white hover:scale-[1.02] active:scale-[0.98] transition-transform shadow-md disabled:opacity-50 disabled:cursor-not-allowed rounded-full w-full sm:w-auto">
                        <Sparkles className="h-4 w-4 mr-2"/>
                        {isPreparing ? translateUI("\u6B63\u5728\u51C6\u5907\u2026") : translateUI("\u751F\u6210\u4F1A\u8BAE\u7EAA\u8981")}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>);
}
