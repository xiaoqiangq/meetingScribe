import { useInterfaceLanguage } from '@/i18n';
import { t as translateUI } from "@/i18n";
import { createContext, useContext, useState, useCallback, useRef, useEffect, type PropsWithChildren, } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { useAudioUpload, useMultiTrackUpload } from "@/features/transcription/hooks/useAudioFiles";
import { useToast } from "@/components/ui/toast";
import { MultiTrackUploadDialog } from "@/features/transcription/components/MultiTrackUploadDialog";
// Types
interface FileWithType {
    file: File;
    isVideo: boolean;
}
interface UploadProgress {
    fileName: string;
    status: "uploading" | "success" | "error";
    error?: string;
}
interface LongUpload {
    id: string; file: File; isVideo: boolean; topicBoundaries: number[];
    status: 'queued' | 'uploading' | 'success' | 'error'; percent: number; error?: string;
}
interface GlobalUploadContextValue {
    startLongUpload: (file: File, isVideo: boolean, topicBoundaries: number[]) => void;

    // File upload
    handleFileSelect: (files: File | File[] | FileWithType | FileWithType[]) => Promise<void>;
    // Multi-track
    handleMultiTrackUpload: (files: File[], aupFile: File, title: string) => Promise<void>;
    openMultiTrackDialog: () => void;
    // Recording completion
    handleRecordingComplete: (blob: Blob, title: string) => Promise<void>;
    // State
    isUploading: boolean;
    uploadProgress: UploadProgress[];
    // For Dashboard to render its own progress bar
    isOnDashboard: boolean;
}
const GlobalUploadContext = createContext<GlobalUploadContextValue | null>(null);
export function GlobalUploadProvider({ children }: PropsWithChildren) {
    useInterfaceLanguage();
    const { mutateAsync: uploadFile } = useAudioUpload();
    const { mutateAsync: uploadMultiTrack } = useMultiTrackUpload();
    const { toast } = useToast();
    const location = useLocation();
    const queryClient = useQueryClient();
    // Check if we're on the dashboard (home page)
    const isOnDashboard = location.pathname === "/" || location.pathname === "";
    // Upload state
    const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const [longUploads, setLongUploads] = useState<LongUpload[]>([]);
    const longQueue = useRef<LongUpload[]>([]);
    const longRunning = useRef(false);
    const updateLong = (id: string, change: Partial<LongUpload>) => setLongUploads(prev => prev.map(row => row.id === id ? { ...row, ...change } : row));
    const drainLongQueue = async () => {
        if (longRunning.current) return;
        longRunning.current = true;
        try {
            while (longQueue.current.length) {
                const row = longQueue.current.shift()!;
                updateLong(row.id, { status: 'uploading' });
                try {
                    await uploadFile({ file: row.file, isVideo: row.isVideo, topicBoundaries: row.topicBoundaries,
                        onProgress: percent => updateLong(row.id, { percent }) });
                    updateLong(row.id, { status: 'success', percent: 100 });
                    toast({ title: translateUI('Upload Complete'), description: row.file.name });
                    void queryClient.invalidateQueries({ queryKey: ['adminUsers'] });
                    void queryClient.invalidateQueries({ queryKey: ['accountUsage'] });
                } catch (error) {
                    updateLong(row.id, { status: 'error', error: error instanceof Error ? error.message : 'Upload failed' });
                }
            }
        } finally { longRunning.current = false; }
    };
    const startLongUpload = (file: File, isVideo: boolean, topicBoundaries: number[]) => {
        const row: LongUpload = { id: crypto.randomUUID(), file, isVideo, topicBoundaries: [...topicBoundaries], status: 'queued', percent: 0 };
        setLongUploads(prev => [...prev, row]);
        longQueue.current.push(row);
        void drainLongQueue();
    };
    const longActive = longUploads.some(row => row.status === 'queued' || row.status === 'uploading');
    useEffect(() => {
        if (!longActive) return;
        const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [longActive]);
    // Multi-track dialog state
    const [isMultiTrackDialogOpen, setIsMultiTrackDialogOpen] = useState(false);
    const [multiTrackPreview, setMultiTrackPreview] = useState<{
        audioFiles: File[];
        aupFile: File;
        title: string;
    } | null>(null);
    const handleFileSelect = useCallback(async (files: File | File[] | FileWithType | FileWithType[]) => {
        // Normalize input to an array of FileWithType objects
        const fileArray = Array.isArray(files) ? files : [files];
        const processedFiles = fileArray.map((item) => {
            if ("file" in item && "isVideo" in item) {
                return item;
            }
            else {
                return { file: item as File, isVideo: false };
            }
        });
        if (processedFiles.length === 0)
            return;
        setIsUploading(true);
        // If on dashboard, use progress bar; otherwise use toasts
        if (isOnDashboard) {
            setUploadProgress(processedFiles.map((item) => ({
                fileName: item.file.name,
                status: "uploading",
            })));
        }
        else {
            toast({
                title: translateUI("Uploading..."),
                description: `Uploading ${processedFiles.length} file(s)`,
            });
        }
        let successCount = 0;
        // Upload files sequentially
        for (let i = 0; i < processedFiles.length; i++) {
            const fileItem = processedFiles[i];
            const file = fileItem.file;
            const isVideo = fileItem.isVideo;
            try {
                await uploadFile({ file, isVideo });
                if (isOnDashboard) {
                    setUploadProgress((prev) => prev.map((item, index) => index === i
                        ? { ...item, status: "success", error: undefined }
                        : item));
                }
                successCount++;
            }
            catch (error) {
                if (isOnDashboard) {
                    setUploadProgress((prev) => prev.map((item, index) => index === i
                        ? {
                            ...item,
                            status: "error",
                            error: error instanceof Error
                                ? error.message
                                : "Upload failed",
                        }
                        : item));
                }
                else {
                    toast({
                        title: "Upload Failed",
                        description: `Failed to upload ${file.name}`,
                    });
                }
            }
        }
        setIsUploading(false);
        // Show success toast if not on dashboard
        if (!isOnDashboard && successCount > 0) {
            toast({
                title: "Upload Complete",
                description: `Successfully uploaded ${successCount} file(s)`,
            });
        }
        // Auto-hide progress after 3 seconds if all succeeded (for dashboard)
        if (isOnDashboard && successCount === fileArray.length) {
            setTimeout(() => setUploadProgress([]), 3000);
        }
    }, [isOnDashboard, uploadFile, toast]);
    const handleMultiTrackUpload = useCallback(async (files: File[], aupFile: File, title: string) => {
        setIsUploading(true);
        if (isOnDashboard) {
            setUploadProgress([
                {
                    fileName: `${title} (${files.length} tracks)`,
                    status: "uploading",
                },
            ]);
        }
        else {
            toast({
                title: "Uploading Multi-Track...",
                description: `Uploading ${title} with ${files.length} tracks`,
            });
        }
        try {
            await uploadMultiTrack({ files, aupFile, title });
            if (isOnDashboard) {
                setUploadProgress([
                    {
                        fileName: `${title} (${files.length} tracks)`,
                        status: "success",
                    },
                ]);
                setTimeout(() => setUploadProgress([]), 3000);
            }
            else {
                toast({
                    title: "Upload Complete",
                    description: `Successfully uploaded ${title}`,
                });
            }
        }
        catch (error) {
            if (isOnDashboard) {
                setUploadProgress([
                    {
                        fileName: `${title} (${files.length} tracks)`,
                        status: "error",
                        error: error instanceof Error ? translateUI(error.message) : "Upload failed",
                    },
                ]);
            }
            else {
                toast({
                    title: "Upload Failed",
                    description: `Failed to upload ${title}`,
                });
            }
        }
        finally {
            setIsUploading(false);
        }
    }, [isOnDashboard, uploadMultiTrack, toast]);
    const openMultiTrackDialog = useCallback(() => {
        setMultiTrackPreview(null);
        setIsMultiTrackDialogOpen(true);
    }, []);
    const handleRecordingComplete = useCallback(async (blob: Blob, title: string) => {
        const file = new File([blob], `${title}.webm`, { type: blob.type });
        await handleFileSelect(file);
    }, [handleFileSelect]);
    const handleMultiTrackDialogClose = useCallback(() => {
        setIsMultiTrackDialogOpen(false);
        setMultiTrackPreview(null);
    }, []);
    const handleMultiTrackConfirm = useCallback(async (files: File[], aupFile: File, title: string) => {
        await handleMultiTrackUpload(files, aupFile, title);
        handleMultiTrackDialogClose();
    }, [handleMultiTrackUpload, handleMultiTrackDialogClose]);
    const value: GlobalUploadContextValue = {
        startLongUpload,
        handleFileSelect,
        handleMultiTrackUpload,
        openMultiTrackDialog,
        handleRecordingComplete,
        isUploading: isUploading || longActive,
        uploadProgress,
        isOnDashboard,
    };
    return (<GlobalUploadContext.Provider value={value}>
            {children}
            {longUploads.length > 0 && <section aria-label={translateUI('后台上传')} className="fixed bottom-4 right-4 z-40 w-[min(420px,calc(100vw-32px))] rounded-xl border bg-background p-4 shadow-lg">
                <h2 className="font-semibold text-sm">{translateUI('后台上传')}</h2>
                <p className="text-xs text-muted-foreground">{translateUI('可以继续使用网站；上传期间请勿刷新或关闭页面。')}</p>
                <div className="max-h-48 overflow-y-auto space-y-3 mt-3">{longUploads.map(row => <div key={row.id} className="text-xs space-y-1">
                    <p className="truncate" title={row.file.name}>{row.file.name}</p>
                    <p role="status">{row.status === 'queued' ? translateUI('等待上传') : row.status === 'uploading' ? row.percent >= 100 ? translateUI('文件已发送，服务器正在处理…') : `${translateUI('Uploading...')} ${row.percent}%` : row.status === 'success' ? translateUI('Upload Complete') : `${translateUI('Upload Failed')}：${translateUI(row.error || '')}`}</p>
                    {row.status === 'uploading' && <progress className="w-full" value={row.percent} max={100}/>}
                    {row.status === 'error' && <button className="underline mr-3" onClick={() => { updateLong(row.id, { status: 'queued', percent: 0, error: undefined }); longQueue.current.push({ ...row, status: 'queued', percent: 0 }); void drainLongQueue(); }}>{translateUI('重试')}</button>}
                    {(row.status === 'success' || row.status === 'error') && <button className="underline" onClick={() => setLongUploads(prev => prev.filter(item => item.id !== row.id))}>{translateUI('关闭')}</button>}
                </div>)}</div>
            </section>}

            {/* Multi-track Upload Dialog (global) */}
            <MultiTrackUploadDialog open={isMultiTrackDialogOpen} onOpenChange={handleMultiTrackDialogClose} onMultiTrackUpload={handleMultiTrackConfirm} prePopulatedFiles={multiTrackPreview?.audioFiles} prePopulatedAupFile={multiTrackPreview?.aupFile} prePopulatedTitle={multiTrackPreview?.title}/>
        </GlobalUploadContext.Provider>);
}
// eslint-disable-next-line react-refresh/only-export-components
export function useGlobalUpload() {
    const ctx = useContext(GlobalUploadContext);
    if (!ctx) {
        throw new Error("useGlobalUpload must be used within GlobalUploadProvider");
    }
    return ctx;
}
