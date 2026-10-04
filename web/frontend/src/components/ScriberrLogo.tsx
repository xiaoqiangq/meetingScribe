import { t as translateUI } from "@/i18n";
import waveformLogo from "@/assets/meeting-assistant-waveform.png";
import { ScriberrTextLogo } from "./ScriberrTextLogo";
export function ScriberrLogo({ className = "", onClick }: {
    className?: string;
    onClick?: () => void;
}) {
    const clickable = typeof onClick === 'function';
    return (<div className={`${className} flex items-center gap-2.5 ${clickable ? 'cursor-pointer hover:opacity-90 focus:opacity-90 outline-none' : ''}`} role={clickable ? 'button' as const : undefined} tabIndex={clickable ? 0 : undefined} onClick={onClick} onKeyDown={(e) => {
            if (!clickable)
                return;
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
            }
        }}>
      <ScriberrIcon className="h-9 w-9 sm:h-10 sm:w-10 select-none"/>
      <ScriberrTextLogo className="text-xl sm:text-2xl leading-none"/>
    </div>);
}
export function ScriberrIcon({ className = "" }: {
    className?: string;
}) {
    return (<span className={`${className} inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white dark:bg-white/95`}>
      <img src={waveformLogo} alt={translateUI("\u4F1A\u8BB0P \u56FE\u6807")} width={1295} height={1214} draggable={false} className="h-full w-full scale-[1.12] object-contain"/>
    </span>);
}
