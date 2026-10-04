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
 const {data: current, isAdmin, isPending} = useCurrentUser();
 const {getAuthHeaders} = useAuth();
 const client = useQueryClient();
 const [name,setName] = useState(''); const [password,setPassword]=useState(''); const [role,setRole]=useState('user');
 const [error,setError]=useState(''); const [busy,setBusy]=useState(false); const [resetID,setResetID]=useState<number|null>(null); const [resetPassword,setResetPassword]=useState('');
 const users=useQuery<CurrentUser[]>({queryKey:['adminUsers'],enabled:isAdmin,queryFn:async()=>{const r=await fetch('/api/v1/admin/users',{headers:getAuthHeaders()});if(!r.ok)throw new Error('无法读取账号');return r.json()}});
 async function save(path:string, method:string, body:unknown) {setBusy(true);setError('');try {const r=await fetch(path,{method,headers:{...getAuthHeaders(),'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error(data.error || '操作失败');await client.invalidateQueries({queryKey:['adminUsers']});return true;}catch(e){setError(e instanceof Error?e.message:'操作失败');return false;}finally{setBusy(false)}}
 if(isPending)return <MainLayout header={<Header/>}><p className="p-6">正在读取权限…</p></MainLayout>;
 if(!isAdmin)return <Navigate to="/" replace/>;
 return <MainLayout header={<Header/>}><div className="mt-8 space-y-6 rounded-2xl border p-6 bg-[var(--bg-card)]">
 <div><h1 className="text-2xl font-bold">账号管理</h1><p className="mt-2 text-sm text-[var(--text-secondary)]">公开注册已关闭。各账号的录音、纪要、聊天和笔记独立保存；停用账号保留其数据。</p></div>
 <form className="space-y-3" onSubmit={async e=>{e.preventDefault();if(await save('/api/v1/admin/users','POST',{username:name,password,role})){setName('');setPassword('')}}}>
 <h2 className="font-semibold">新增账号</h2><div className="flex flex-wrap gap-3"><Input className="max-w-xs" aria-label="新账号用户名" placeholder="用户名" value={name} maxLength={50} required onChange={e=>setName(e.target.value)}/><Input className="max-w-xs" aria-label="新账号密码" placeholder="密码（至少8字节）" type="password" autoComplete="new-password" minLength={8} maxLength={72} required value={password} onChange={e=>setPassword(e.target.value)}/><select className="rounded-md border bg-[var(--bg-card)] p-2" aria-label="新账号角色" value={role} onChange={e=>setRole(e.target.value)}><option value="user">普通用户</option><option value="admin">管理员</option></select><Button disabled={busy} type="submit">创建账号</Button></div></form>
 {error && <p role="alert" className="text-red-600">{error}</p>}{users.error && <p role="alert">账号列表读取失败，请刷新重试。</p>}
 <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-3">用户名</th><th>角色</th><th>状态</th><th>操作</th></tr></thead><tbody>{users.data?.map(user=><tr key={user.id} className="border-b"><td className="p-3">{user.username}{user.id===current?.id?'（当前账号）':''}</td><td>{user.role==='admin'?'管理员':'普通用户'}</td><td>{user.disabled?'已停用':'启用'}</td><td className="flex flex-wrap gap-2 py-3"><Button variant="outline" disabled={busy || user.id===current?.id} onClick={()=>save(`/api/v1/admin/users/${user.id}`,'PATCH',{disabled:!user.disabled})}>{user.disabled?'启用':'停用'}</Button><Button variant="outline" disabled={busy || user.id===current?.id} onClick={()=>save(`/api/v1/admin/users/${user.id}`,'PATCH',{role:user.role==='admin'?'user':'admin'})}>{user.role==='admin'?'设为普通用户':'设为管理员'}</Button><Button variant="outline" disabled={busy || user.id===current?.id} onClick={()=>{setResetID(user.id);setResetPassword('');setError('')}}>重置密码</Button></td></tr>)}</tbody></table></div>
 {resetID!==null && <form className="space-y-3 rounded-xl border p-4" onSubmit={async e=>{e.preventDefault();if(await save(`/api/v1/admin/users/${resetID}`,'PATCH',{password:resetPassword})){setResetID(null);setResetPassword('')}}}><h2 className="font-semibold">重置 {users.data?.find(u=>u.id===resetID)?.username} 的密码</h2><p className="text-sm">保存后该账号的旧登录和 API 凭证失效。</p><Input aria-label="重置后的密码" type="password" autoComplete="new-password" minLength={8} maxLength={72} required value={resetPassword} onChange={e=>setResetPassword(e.target.value)}/><div className="flex gap-2"><Button disabled={busy}>保存新密码</Button><Button type="button" variant="outline" onClick={()=>{setResetID(null);setResetPassword('')}}>取消</Button></div></form>}
 </div></MainLayout>
}
