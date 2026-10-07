export function isKnownDuration(value: number): boolean {
    return Number.isFinite(value) && value > 0;
}

export function formatMediaTime(value: number): string {
    if (!Number.isFinite(value) || value < 0) return "--:--";
    const seconds = Math.floor(value);
    return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

// MediaRecorder WebM files can omit duration metadata. A separate, silent
// element seeks to EOF so the browser can discover it without moving playback.
// Normal files continue to use metadata-only streaming.
export function recoverMediaDuration(
    source: string,
    onDuration: (duration: number) => void,
    createAudio: () => HTMLAudioElement = () => document.createElement("audio"),
): () => void {
    const probe = createAudio();
    let disposed = false;
    const cleanup = () => {
        if (disposed) return;
        disposed = true;
        clearTimeout(timeout);
        for (const event of ["loadedmetadata", "durationchange", "timeupdate", "seeked"]) {
            probe.removeEventListener(event, inspect);
        }
        probe.removeEventListener("error", cleanup);
        probe.removeAttribute("src");
        probe.load();
    };
    const inspect = () => {
        if (disposed) return;
        if (isKnownDuration(probe.duration)) {
            const duration = probe.duration;
            cleanup();
            onDuration(duration);
        } else if (probe.duration === Infinity && probe.currentTime === 0) {
            try {
                probe.currentTime = 1e10;
            } catch {
                cleanup();
            }
        }
    };
    const timeout = setTimeout(cleanup, 30_000);
    probe.muted = true;
    probe.preload = "auto";
    probe.crossOrigin = "use-credentials";
    for (const event of ["loadedmetadata", "durationchange", "timeupdate", "seeked"]) {
        probe.addEventListener(event, inspect);
    }
    probe.addEventListener("error", cleanup);
    probe.src = source;
    probe.load();
    return cleanup;
}
