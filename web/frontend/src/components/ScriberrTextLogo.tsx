import { useInterfaceLanguage } from '@/i18n';
import { t as translateUI } from "@/i18n";
export function ScriberrTextLogo({ className = "" }: {
    className?: string;
}) {
    useInterfaceLanguage();
    return (<span className={`${className} inline-flex items-baseline whitespace-nowrap text-[var(--text-primary)]`} aria-label={translateUI("\u4F1A\u8BB0P")}>
      <span style={{ fontFamily: '"Kaiti SC", STKaiti, KaiTi, "Noto Serif CJK SC", "Songti SC", SimSun, serif', fontWeight: 600, letterSpacing: '0.1em' }}>{translateUI("\u4F1A\u8BB0")}</span>
      <span aria-hidden="true" className="ml-0.5 text-[0.9em] font-normal italic text-[var(--brand-solid)]" style={{ fontFamily: 'Georgia, serif' }}>P</span>
    </span>);
}
