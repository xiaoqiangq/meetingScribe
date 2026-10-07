export function ScriberrTextLogo({ className = "" }: { className?: string }) {
    return <span className={`${className} font-semibold whitespace-nowrap text-[var(--text-primary)]`} aria-label="MeetingScribe">MeetingScribe</span>;
}
