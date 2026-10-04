import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
export interface CurrentUser { id: number; username: string; role: 'admin' | 'user'; disabled: boolean; created_at: string }
export function useCurrentUser() {
 const token = useAuthStore(s => s.token);
 const query = useQuery<CurrentUser>({
  queryKey: ['currentUser', token], enabled: !!token, staleTime: 30000,
  queryFn: async () => { const res = await fetch('/api/v1/auth/me', {headers: {Authorization: `Bearer ${token}`}}); if (!res.ok) throw new Error('无法读取账号权限'); return res.json(); }
 });
 return {...query, isAdmin: query.data?.role === 'admin'};
}
