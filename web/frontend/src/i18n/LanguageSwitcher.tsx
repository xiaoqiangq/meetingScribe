import { useInterfaceLanguage, setInterfaceLanguage, type InterfaceLanguage } from './index';
export function LanguageSwitcher({embedded = false}: {embedded?: boolean}) {
    const current = useInterfaceLanguage();
    function select(language: InterfaceLanguage) {
        if (language === current) return;
        setInterfaceLanguage(language);
    }
    return <div className={`${embedded ? "justify-self-end inline-flex" : "fixed bottom-4 right-4 z-[100] inline-flex"} rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card)] p-1 shadow-lg`} role="group" aria-label="Interface language / 界面语言">
        <button type="button" lang="en" aria-pressed={current === 'en'} onClick={() => select('en')} className={`rounded-full px-3 py-1.5 text-xs font-medium cursor-pointer ${current === 'en' ? 'bg-[var(--brand-solid)] text-white' : 'text-[var(--text-secondary)]'}`}>English</button>
        <button type="button" lang="zh-CN" aria-pressed={current === 'zh'} onClick={() => select('zh')} className={`rounded-full px-3 py-1.5 text-xs font-medium cursor-pointer ${current === 'zh' ? 'bg-[var(--brand-solid)] text-white' : 'text-[var(--text-secondary)]'}`}>中文</button>
    </div>;
}
