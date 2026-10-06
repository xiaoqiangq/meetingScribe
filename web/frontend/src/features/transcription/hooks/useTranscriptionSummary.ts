import { t as translateUI } from "@/i18n";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/hooks/useAuth";
import { useState } from "react";
import { buildSummaryContent } from "../components/audio-detail/summaryTranscript";
export interface SummaryTemplate {
    id: string;
    name: string;
    model: string;
    prompt: string;
}
export function useSummaryTemplates() {
    const { getAuthHeaders } = useAuth();
    return useQuery({
        queryKey: ["summaryTemplates"],
        queryFn: async () => {
            const response = await fetch("/api/v1/summaries", {
                headers: getAuthHeaders(),
            });
            if (!response.ok)
                throw new Error("Failed to load summary templates");
            return response.json() as Promise<SummaryTemplate[]>;
        },
        staleTime: 5 * 60 * 1000, // Templates don't change often
    });
}
export function useExistingSummary(audioId: string, enabled = true) {
    const { getAuthHeaders } = useAuth();
    return useQuery({
        queryKey: ["summary", audioId],
        queryFn: async () => {
            const response = await fetch(`/api/v1/transcription/${audioId}/summary`, {
                headers: getAuthHeaders(),
            });
            if (!response.ok)
                throw new Error('Failed to load saved summary');
            return response.json() as Promise<{
                content: string;
            }>;
        },
        retry: false,
        enabled,
    });
}
export interface SummaryHistoryEntry {
    id: string;
    template_id: string | null;
    template_name: string;
    model: string;
    content: string;
    created_at: string;
    status: "completed" | "failed" | "partial";
    error_message?: string;
}
export function useSummaryHistory(audioId: string, enabled: boolean) {
    const { getAuthHeaders } = useAuth();
    return useQuery({
        queryKey: ['summaryHistory', audioId],
        queryFn: async () => {
            const response = await fetch(`/api/v1/transcription/${audioId}/summary/history`, { headers: getAuthHeaders() });
            if (!response.ok)
                throw new Error(translateUI("\u65E0\u6CD5\u8BFB\u53D6\u5386\u53F2\u7EAA\u8981"));
            return response.json() as Promise<SummaryHistoryEntry[]>;
        },
        enabled,
    });
}
export function useSummarizer(audioId: string) {
    const { getAuthHeaders } = useAuth();
    const queryClient = useQueryClient();
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamContent, setStreamContent] = useState("");
    const [error, setError] = useState<string | null>(null);
    const generateSummary = async (templateId: string, model: string, prompt: string, transcriptText: string) => {
        setIsStreaming(true);
        setStreamContent("");
        setError(null);
        const combinedContent = buildSummaryContent(transcriptText, prompt);
        try {
            const res = await fetch('/api/v1/summarize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({
                    model: model,
                    content: combinedContent,
                    transcription_id: audioId,
                    template_id: templateId
                }),
            });
            if (!res.ok)
                throw new Error((translateUI("\u4F1A\u8BAE\u7EAA\u8981\u8BF7\u6C42\u5931\u8D25\uFF08") + res.status + "\uFF09"));
            if (!res.body) {
                throw new Error('Failed to start summary stream.');
            }
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let completedContent = '';
            let buffer = '';
            let confirmed = false;
            const consume = (line: string) => {
                if (!line.trim()) return;
                const event = JSON.parse(line);
                if (event.type === 'chunk') {
                    completedContent += event.content;
                    setStreamContent(completedContent);
                } else if (event.type === 'done' && event.status === 'completed') confirmed = true;
                else if (event.type === 'error') throw new Error(event.error || 'Summary generation failed');
            };
            while (true) {
                const { done, value } = await reader.read();
                buffer += done ? decoder.decode() : decoder.decode(value, {stream: true});
                let newline: number;
                while ((newline = buffer.indexOf('\n')) >= 0) {
                    consume(buffer.slice(0, newline));
                    buffer = buffer.slice(newline + 1);
                }
                if (done) { consume(buffer); break; }
            }
            if (!confirmed) throw new Error(translateUI('Connection interrupted; this summary is incomplete.'));
            // Invalidate summary query after successful generation
            if (completedContent)
                queryClient.setQueryData(["summary", audioId], { content: completedContent });
            await queryClient.invalidateQueries({ queryKey: ["summary", audioId] });
            await queryClient.invalidateQueries({ queryKey: ['summaryHistory', audioId] });
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "Summary generation failed");
        }
        finally {
            setIsStreaming(false);
            void queryClient.invalidateQueries({ queryKey: ["summaryHistory", audioId] });
        }
    };
    return { generateSummary, isStreaming, streamContent, error };
}
