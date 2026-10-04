import { t as translateUI } from "@/i18n";
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useCurrentUser } from '@/features/auth/hooks/useCurrentUser';
export function AdminRoute({ children }: {
    children: ReactNode;
}) {
    const { isAdmin, isPending } = useCurrentUser();
    if (isPending)
        return <p className="p-6">{translateUI("\u6B63\u5728\u8BFB\u53D6\u6743\u9650\u2026")}</p>;
    return isAdmin ? children : <Navigate to="/" replace/>;
}
