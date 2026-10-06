import { useInterfaceLanguage } from '@/i18n';
import { t as translateUI } from "@/i18n";
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { useCurrentUser, type CurrentUser } from '@/features/auth/hooks/useCurrentUser';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { MainLayout } from '@/components/layout/MainLayout';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
export function UsersPage() {
    useInterfaceLanguage();
    const { data: current, isAdmin, isPending } = useCurrentUser();
    const { getAuthHeaders } = useAuth();
    const client = useQueryClient();
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState('user');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [resetID, setResetID] = useState<number | null>(null);
    const [resetPassword, setResetPassword] = useState('');
    const users = useQuery<CurrentUser[]>({ queryKey: ['adminUsers'], enabled: isAdmin, queryFn: async () => {
            const r = await fetch('/api/v1/admin/users', { headers: getAuthHeaders() });
            if (!r.ok)
                throw new Error(translateUI("\u65E0\u6CD5\u8BFB\u53D6\u8D26\u53F7"));
            return r.json();
        } });
    async function save(path: string, method: string, body: unknown) {
        setBusy(true);
        setError('');
        try {
            const r = await fetch(path, { method, headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const data = await r.json();
            if (!r.ok)
                throw new Error(data.error || translateUI("\u64CD\u4F5C\u5931\u8D25"));
            await client.invalidateQueries({ queryKey: ['adminUsers'] });
            return true;
        }
        catch (e) {
            setError(e instanceof Error ? e.message : translateUI("\u64CD\u4F5C\u5931\u8D25"));
            return false;
        }
        finally {
            setBusy(false);
        }
    }
    if (isPending)
        return <MainLayout header={<Header />}><p className="p-6">{translateUI("\u6B63\u5728\u8BFB\u53D6\u6743\u9650\u2026")}</p></MainLayout>;
    if (!isAdmin)
        return <Navigate to="/" replace/>;
    return <MainLayout header={<Header />}><div className="mt-8 space-y-6 rounded-2xl border p-6 bg-[var(--bg-card)]">
 <div><h1 className="text-2xl font-bold">{translateUI("\u8D26\u53F7\u7BA1\u7406")}</h1><p className="mt-2 text-sm text-[var(--text-secondary)]">{translateUI("\u516C\u5F00\u6CE8\u518C\u5DF2\u5173\u95ED\u3002\u5404\u8D26\u53F7\u7684\u5F55\u97F3\u3001\u7EAA\u8981\u3001\u804A\u5929\u548C\u7B14\u8BB0\u72EC\u7ACB\u4FDD\u5B58\uFF1B\u505C\u7528\u8D26\u53F7\u4FDD\u7559\u5176\u6570\u636E\u3002")}</p></div>
 <form className="space-y-3" onSubmit={async (e) => {
            e.preventDefault();
            if (await save('/api/v1/admin/users', 'POST', { username: name, password, role })) {
                setName('');
                setPassword('');
            }
        }}>
 <h2 className="font-semibold">{translateUI("\u65B0\u589E\u8D26\u53F7")}</h2><div className="flex flex-wrap gap-3"><Input className="max-w-xs" aria-label={translateUI("\u65B0\u8D26\u53F7\u7528\u6237\u540D")} placeholder={translateUI("\u7528\u6237\u540D")} value={name} maxLength={50} required onChange={e => setName(e.target.value)}/><Input className="max-w-xs" aria-label={translateUI("\u65B0\u8D26\u53F7\u5BC6\u7801")} placeholder={translateUI("\u5BC6\u7801\uFF08\u81F3\u5C118\u5B57\u8282\uFF09")} type="password" autoComplete="new-password" minLength={8} maxLength={72} required value={password} onChange={e => setPassword(e.target.value)}/><select className="rounded-md border bg-[var(--bg-card)] p-2" aria-label={translateUI("\u65B0\u8D26\u53F7\u89D2\u8272")} value={role} onChange={e => setRole(e.target.value)}><option value="user">{translateUI("\u666E\u901A\u7528\u6237")}</option><option value="admin">{translateUI("\u7BA1\u7406\u5458")}</option></select><Button disabled={busy} type="submit">{translateUI("\u521B\u5EFA\u8D26\u53F7")}</Button></div></form>
 {error && <p role="alert" className="text-red-600">{error}</p>}{users.error && <p role="alert">{translateUI("\u8D26\u53F7\u5217\u8868\u8BFB\u53D6\u5931\u8D25\uFF0C\u8BF7\u5237\u65B0\u91CD\u8BD5\u3002")}</p>}
 <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-3">{translateUI("\u7528\u6237\u540D")}</th><th>{translateUI("\u89D2\u8272")}</th><th>{translateUI("\u72B6\u6001")}</th><th>{translateUI("\u64CD\u4F5C")}</th></tr></thead><tbody>{users.data?.map(user => <tr key={user.id} className="border-b"><td className="p-3">{user.username}{user.id === current?.id ? translateUI("\uFF08\u5F53\u524D\u8D26\u53F7\uFF09") : ''}</td><td>{user.role === 'admin' ? translateUI("\u7BA1\u7406\u5458") : translateUI("\u666E\u901A\u7528\u6237")}</td><td>{user.disabled ? translateUI("\u5DF2\u505C\u7528") : translateUI("\u542F\u7528")}</td><td className="flex flex-wrap gap-2 py-3"><Button variant="outline" disabled={busy || user.id === current?.id} onClick={() => save(`/api/v1/admin/users/${user.id}`, 'PATCH', { disabled: !user.disabled })}>{user.disabled ? translateUI("\u542F\u7528") : translateUI("\u505C\u7528")}</Button><Button variant="outline" disabled={busy || user.id === current?.id} onClick={() => save(`/api/v1/admin/users/${user.id}`, 'PATCH', { role: user.role === 'admin' ? 'user' : 'admin' })}>{user.role === 'admin' ? translateUI("\u8BBE\u4E3A\u666E\u901A\u7528\u6237") : translateUI("\u8BBE\u4E3A\u7BA1\u7406\u5458")}</Button><Button variant="outline" disabled={busy || user.id === current?.id} onClick={() => { setResetID(user.id); setResetPassword(''); setError(''); }}>{translateUI("\u91CD\u7F6E\u5BC6\u7801")}</Button></td></tr>)}</tbody></table></div>
 {resetID !== null && <form className="space-y-3 rounded-xl border p-4" onSubmit={async (e) => {
                e.preventDefault();
                if (await save(`/api/v1/admin/users/${resetID}`, 'PATCH', { password: resetPassword })) {
                    setResetID(null);
                    setResetPassword('');
                }
            }}><h2 className="font-semibold">{translateUI("\u91CD\u7F6E")}{users.data?.find(u => u.id === resetID)?.username}{translateUI("\u7684\u5BC6\u7801")}</h2><p className="text-sm">{translateUI("\u4FDD\u5B58\u540E\u8BE5\u8D26\u53F7\u7684\u65E7\u767B\u5F55\u548C API \u51ED\u8BC1\u5931\u6548\u3002")}</p><Input aria-label={translateUI("\u91CD\u7F6E\u540E\u7684\u5BC6\u7801")} type="password" autoComplete="new-password" minLength={8} maxLength={72} required value={resetPassword} onChange={e => setResetPassword(e.target.value)}/><div className="flex gap-2"><Button disabled={busy}>{translateUI("\u4FDD\u5B58\u65B0\u5BC6\u7801")}</Button><Button type="button" variant="outline" onClick={() => { setResetID(null); setResetPassword(''); }}>{translateUI("\u53D6\u6D88")}</Button></div></form>}
 </div></MainLayout>;
}
