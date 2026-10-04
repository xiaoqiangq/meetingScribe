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
if (typeof document !== 'undefined') document.title = getInterfaceLanguage() === 'zh' ? '会记P' : 'Huiji P';
