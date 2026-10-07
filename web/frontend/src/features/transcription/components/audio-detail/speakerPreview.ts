// Attach listeners before metadata or seek events; cleanup cancels pending playback.
export function playSpeakerPreview(
    audio: HTMLAudioElement,
    window: { start: number; end: number },
    callbacks: { started: () => void; failed: (message: string) => void; setEnd: (end: number | undefined) => void },
): () => void {
    let cancelled = false;
    callbacks.setEnd(undefined);
    audio.pause();
    const play = () => {
        if (cancelled || audio.seeking) return;
        callbacks.setEnd(window.end);
        void audio.play().then(() => {
            if (!cancelled) callbacks.started();
        }).catch(() => {
            if (!cancelled) callbacks.failed("请点击播放器播放");
        });
    };
    const seek = () => {
        if (Math.abs(audio.currentTime - window.start) < 0.01) play();
        else audio.currentTime = window.start;
    };
    const failed = () => { if (!cancelled) callbacks.failed("试听失败"); };
    audio.addEventListener('loadedmetadata', seek);
    audio.addEventListener('seeked', play);
    audio.addEventListener('error', failed);
    if (audio.readyState >= 1) seek();
    return () => {
        cancelled = true;
        audio.pause();
        callbacks.setEnd(undefined);
        audio.removeEventListener('loadedmetadata', seek);
        audio.removeEventListener('seeked', play);
        audio.removeEventListener('error', failed);
    };
}
