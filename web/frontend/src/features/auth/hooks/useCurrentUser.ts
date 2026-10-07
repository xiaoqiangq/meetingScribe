import { t as translateUI } from "@/i18n";
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
export interface CurrentUser {
    id: number;
    username: string;
    role: 'admin' | 'user';
    disabled: boolean;
    created_at: string;
    project_limit?: number;
    file_quota_bytes?: number;
    audio_quota_bytes?: number;
    project_count?: number;
    completed_count?: number;
    active_count?: number;
    audio_bytes?: number;
    artifact_bytes?: number;
    storage_bytes?: number;
    quota_bytes?: number;
    usage_incomplete?: boolean;
}
export function useCurrentUser() {
    const token = useAuthStore(s => s.token);
    const query = useQuery<CurrentUser>({
        queryKey: ['currentUser', token], enabled: !!token, staleTime: 30000,
        queryFn: async () => {
            const res = await fetch('/api/v1/auth/me', { headers: { Authorization: `Bearer ${token}` } });
            if (!res.ok)
                throw new Error(translateUI("\u65E0\u6CD5\u8BFB\u53D6\u8D26\u53F7\u6743\u9650"));
            return res.json();
        }
    });
    return { ...query, isAdmin: query.data?.role === 'admin' };
}
