import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useCurrentUser, type CurrentUser } from '@/features/auth/hooks/useCurrentUser';
import { t, useInterfaceLanguage } from '@/i18n';
import { Button } from '@/components/ui/button';
const size = (bytes = 0) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GiB` : `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
export function AccountUsage({ compact = false }: { compact?: boolean }) {
    useInterfaceLanguage();
    const {getAuthHeaders} = useAuth();
    const {data: current} = useCurrentUser();
    const usage = useQuery<CurrentUser>({queryKey:['accountUsage', current?.id], enabled:!!current?.id, refetchInterval:30000,
        queryFn:async()=>{const r=await fetch('/api/v1/auth/me/usage',{headers:getAuthHeaders()});if(!r.ok)throw Error(t('无法读取用量'));return r.json();}});
    const user = usage.data;
    if (compact) return <section aria-label={t('我的用量与额度')} className="md:ml-auto min-w-0 rounded-lg border bg-[var(--bg-card)] px-3 py-2">
        {usage.isPending && <p className="text-xs text-muted-foreground">{t('Loading...')}</p>}
        {usage.error && <button className="text-xs text-red-600" onClick={()=>void usage.refetch()}>{t('无法读取用量')} · {t('重试')}</button>}
        {user && <div className="grid grid-cols-3 gap-x-4 text-xs">
            <div><p className="text-muted-foreground">{t('项目 / 任务')}</p><p className="font-medium mt-0.5">{user.project_count} / {user.project_limit || t('不限')}</p></div>
            <div><p className="text-muted-foreground">{t('文件占用')}</p><p className="font-medium mt-0.5">{user.usage_incomplete?'≈ ':''}{size(user.storage_bytes)} / {user.file_quota_bytes ? size(user.file_quota_bytes) : t('不限')}</p></div>
            <div><p className="text-muted-foreground">{t('录音配额')}</p><p className="font-medium mt-0.5">{size(user.audio_bytes)} / {size(user.quota_bytes)}</p></div>
        </div>}
    </section>;
    return <section className="rounded-xl border p-5 space-y-3">
        <div className="flex justify-between items-center"><h2 className="font-semibold">{t('我的用量与额度')}</h2><Button variant="outline" disabled={usage.isFetching} onClick={()=>void usage.refetch()}>{t('刷新统计')}</Button></div>
        {usage.isPending && <p>{t('Loading...')}</p>}
        {usage.error && <p role="alert">{t('无法读取用量')}</p>}
        {user && <div className="grid gap-4 sm:grid-cols-3">
            <div><p className="text-sm text-muted-foreground">{t('项目 / 任务')}</p><p className="text-xl font-semibold">{user.project_count} / {user.project_limit || t('不限')}</p><p className="text-xs">{t('已完成')} {user.completed_count} · {t('进行中')} {user.active_count}</p></div>
            <div><p className="text-sm text-muted-foreground">{t('文件占用')}</p><p className="text-xl font-semibold">{user.usage_incomplete?'≈ ':''}{size(user.storage_bytes)} / {user.file_quota_bytes ? size(user.file_quota_bytes) : t('不限')}</p></div>
            <div><p className="text-sm text-muted-foreground">{t('录音配额')}</p><p className="text-xl font-semibold">{size(user.audio_bytes)} / {size(user.quota_bytes)}</p></div>
        </div>}
        <p className="text-xs text-muted-foreground">{t('空间按当前项目文件统计，不含共享模型和数据库。额度由管理员设置，达到上限后限制新上传；处理结果可能继续增长。')}</p>
    </section>;
}
