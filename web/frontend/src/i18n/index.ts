import { useSyncExternalStore } from 'react';
import messages from './messages.json';
import englishChinese from './english-zh.json';
export type InterfaceLanguage = 'en' | 'zh';
export function getInterfaceLanguage(): InterfaceLanguage {
    try { return localStorage.getItem('huiji-interface-language') === 'zh' ? 'zh' : 'en'; }
    catch { return 'en'; }
}
const zhToEn: Record<string, string> = messages;
const enToZh: Record<string, string> = {...Object.fromEntries(Object.entries(messages).map(([zh, en]) => [en, zh])), ...englishChinese};
/** Translate only source-authored interface messages, never recording content. */
export function t(message: string): string {
    const core = message.trim();
    const translated = getInterfaceLanguage() === 'zh' ? (enToZh[core] || core) : (zhToEn[core] || core);
    return message.replace(core, translated);
}
export function getLocale(): string { return getInterfaceLanguage() === 'zh' ? 'zh-CN' : 'en-US'; }
if (typeof document !== 'undefined') document.documentElement.lang = getInterfaceLanguage() === 'zh' ? 'zh-CN' : 'en';
if (typeof document !== 'undefined') document.title = 'MeetingScribe';

const subscribers = new Set<() => void>();
export function useInterfaceLanguage() {
    return useSyncExternalStore(listener => {subscribers.add(listener);return () => {subscribers.delete(listener);};}, getInterfaceLanguage, () => 'en');
}
export function setInterfaceLanguage(language: InterfaceLanguage) {
    localStorage.setItem('huiji-interface-language', language);
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    document.title = 'MeetingScribe';
    subscribers.forEach(listener => listener());
}
window.addEventListener('storage', event => {if(event.key === 'huiji-interface-language') subscribers.forEach(listener => listener());});
