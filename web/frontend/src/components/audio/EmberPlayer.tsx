import { useRef, useState, useEffect, forwardRef, useImperativeHandle, useCallback } from "react";
import { t } from "@/i18n";
import { Play, Pause, AlertCircle } from "lucide-react";
import { AudioVisualizer } from "./AudioVisualizer";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/hooks/useAuth";
import { formatMediaTime, isKnownDuration, recoverMediaDuration } from "./mediaDuration";

export interface EmberPlayerRef {
    seekTo: (time: number) => void;
    playPause: () => void;
    isPlaying: () => boolean;
}

export interface EmberPlayerProps {
    src?: string;
    disabled?: boolean;
    audioId?: string;
    className?: string;
    onTimeUpdate?: (time: number) => void;
    onPlayStateChange?: (isPlaying: boolean) => void;
}

export const EmberPlayer = forwardRef<EmberPlayerRef, EmberPlayerProps>(
    ({ src, audioId, className, onTimeUpdate, onPlayStateChange, disabled = false }, ref) => {
        const audioRef = useRef<HTMLAudioElement>(null);
        const progressRef = useRef<HTMLDivElement>(null);
        const fallbackStartedRef = useRef(false);
        const objectUrlRef = useRef<string | null>(null);
        const durationRecoveryRef = useRef<(() => void) | null>(null);
        const { getAuthHeaders } = useAuth();

        const [isPlaying, setIsPlaying] = useState(false);
        const [currentTime, setCurrentTime] = useState(0);
        const [duration, setDuration] = useState(0);
        const [error, setError] = useState<string | null>(null);
        const [streamUrl, setStreamUrl] = useState(src || (audioId ? `/api/v1/transcription/${audioId}/audio` : undefined));

        // Visualizer Interaction State
        const [hoverTime, setHoverTime] = useState(0);
        const [isHovering, setIsHovering] = useState(false);
        const [isDragging, setIsDragging] = useState(false);

        // --- 1. Parent Control (ForwardRef) ---
        useImperativeHandle(ref, () => ({
            seekTo: (time: number) => {
                if (!disabled && audioRef.current && Number.isFinite(time)) {
                    const target = Math.max(0, isKnownDuration(duration) ? Math.min(time, duration) : time);
                    audioRef.current.currentTime = target;
                    setCurrentTime(target);
                    onTimeUpdate?.(target);
                }
            },
            playPause: () => togglePlay(),
            isPlaying: () => isPlaying
        }));

        // Only one project/preview audio should be audible at a time.
        useEffect(() => {
            const pauseForPreview = () => audioRef.current?.pause();
            window.addEventListener('huiji:preview-start', pauseForPreview);
            return () => window.removeEventListener('huiji:preview-start', pauseForPreview);
        }, []);

        // --- 2. URL Logic ---
        useEffect(() => {
            fallbackStartedRef.current = false;
            setError(null);
            setDuration(0);
            setCurrentTime(0);
            setIsDragging(false);
            setIsPlaying(false);
            setStreamUrl(src || (audioId ? `/api/v1/transcription/${audioId}/audio` : undefined));
            return () => {
                durationRecoveryRef.current?.();
                durationRecoveryRef.current = null;
                if (objectUrlRef.current) {
                    URL.revokeObjectURL(objectUrlRef.current);
                    objectUrlRef.current = null;
                }
            };
        }, [src, audioId]);

        // Native media requests cannot attach the Bearer token used by the API.
        // Prefer cookie-backed streaming, but recover if an older login has no access cookie.
        const handleAudioError = async () => {
            if (!audioId || (src && src.split("?")[0] !== `/api/v1/transcription/${audioId}/audio`) || fallbackStartedRef.current) {
                setError("Unable to load audio stream.");
                return;
            }
            fallbackStartedRef.current = true;
            try {
                const response = await fetch(src || `/api/v1/transcription/${audioId}/audio`, {
                    headers: getAuthHeaders(),
                    credentials: "include",
                });
                if (!response.ok) throw new Error(`Audio request failed: ${response.status}`);
                const blobUrl = URL.createObjectURL(await response.blob());
                objectUrlRef.current = blobUrl;
                setStreamUrl(blobUrl);
            } catch (loadError) {
                console.error("Authenticated audio load failed:", loadError);
                setError("Unable to load audio stream.");
            }
        };

        useEffect(() => { if (disabled) audioRef.current?.pause(); }, [disabled]);
        // --- 3. Audio Handlers ---
        const togglePlay = () => {
            if (disabled || !audioRef.current) return;
            if (isPlaying) {
                audioRef.current.pause();
            } else {
                audioRef.current.play().catch(e => {
                    console.error("Playback failed:", e);
                    setError("Playback failed.");
                });
            }
        };

        const handleTimeUpdate = () => {
            if (audioRef.current && !isDragging) {
                const time = audioRef.current.currentTime;
                setCurrentTime(time);
                onTimeUpdate?.(time);
            }
        };

        const handleLoadedMetadata = () => {
            const audio = audioRef.current;
            if (!audio) return;
            if (isKnownDuration(audio.duration)) {
                setDuration(audio.duration);
            } else if (audio.duration === Infinity && !durationRecoveryRef.current && audio.currentSrc) {
                durationRecoveryRef.current = recoverMediaDuration(audio.currentSrc, setDuration);
            }
            setError(null);
        };

        // --- 4. Advanced Scrubber Logic ---
        const calculateTimeFromEvent = useCallback((e: React.MouseEvent | MouseEvent) => {
            if (!progressRef.current || !isKnownDuration(duration)) return 0;
            const rect = progressRef.current.getBoundingClientRect();
            if (rect.width <= 0) return 0;
            let x = e.clientX - rect.left;
            x = Math.max(0, Math.min(x, rect.width));
            return (x / rect.width) * duration;
        }, [duration]);

        const handleScrubberMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
            if (disabled || !isKnownDuration(duration)) return;
            setIsDragging(true);
            const time = calculateTimeFromEvent(e);
            if (audioRef.current) {
                audioRef.current.currentTime = time;
                setCurrentTime(time);
                onTimeUpdate?.(time);
            }
        };

        // Global mouse listeners for dragging outside the component
        useEffect(() => {
            const handleGlobalMouseMove = (e: MouseEvent) => {
                if (isDragging && audioRef.current && progressRef.current) {
                    const time = calculateTimeFromEvent(e);
                    audioRef.current.currentTime = time;
                    setCurrentTime(time);
                    onTimeUpdate?.(time);
                }
            };

            const handleGlobalMouseUp = () => {
                setIsDragging(false);
            };

            if (isDragging) {
                window.addEventListener("mousemove", handleGlobalMouseMove);
                window.addEventListener("mouseup", handleGlobalMouseUp);
            }

            return () => {
                window.removeEventListener("mousemove", handleGlobalMouseMove);
                window.removeEventListener("mouseup", handleGlobalMouseUp);
            };
        }, [isDragging, calculateTimeFromEvent, onTimeUpdate]);

        const handleHoverMove = (e: React.MouseEvent<HTMLDivElement>) => {
            if (!progressRef.current || !isKnownDuration(duration)) return;
            const rect = progressRef.current.getBoundingClientRect();
            if (rect.width <= 0) return;
            const x = e.clientX - rect.left;
            const percent = Math.min(Math.max(0, x / rect.width), 1);
            setHoverTime(percent * duration);
        };

        // Sync State
        useEffect(() => {
            onPlayStateChange?.(isPlaying);
        }, [isPlaying, onPlayStateChange]);


        const formatTime = formatMediaTime;
        const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
        const hoverPercent = duration > 0 ? hoverTime / duration : 0;

        if (error) {
            return (
                <div className="w-full h-32 flex items-center justify-center text-[var(--error)] bg-[var(--error)]/10 rounded-[var(--radius-card)] border border-[var(--error)]/20">
                    <AlertCircle className="w-5 h-5 mr-2" />
                    {error}
                </div>
            );
        }

        return (
            <div
                className={cn(
                    // Base Container Styles - designed to fill the parent card
                    "relative w-full overflow-hidden rounded-[var(--radius-card)]",
                    // Use standard background matching the design system
                    "bg-transparent",
                    className
                )}
            >
                {/* Visualizer Layer (Background) */}
                {/* Removed mix-blend-screen which makes viz invisible on white. Added minimal opacity for subtlety */}
                <div className="absolute inset-0 z-0 h-full w-full pointer-events-none opacity-40">
                    <AudioVisualizer
                        audioRef={audioRef}
                        isPlaying={isPlaying}
                        isHovering={isHovering}
                        hoverPercent={hoverPercent}
                    />
                </div>

                {/* Controls Layer */}
                <div className="relative z-10 flex flex-col px-1 py-1 gap-3">
                    {/* Top Row: Button & Time */}
                    <div className="flex items-center justify-between">
                        <button
                            aria-label={t(isPlaying ? "Pause" : "Play")}
                            disabled={disabled} onClick={togglePlay}
                            className="flex h-12 w-12 items-center justify-center rounded-full bg-[image:var(--brand-gradient)] text-white shadow-lg shadow-orange-500/20 hover:scale-105 active:scale-95 transition-all focus:outline-none cursor-pointer"
                        >
                            {isPlaying ? (
                                <Pause size={20} fill="currentColor" />
                            ) : (
                                <Play size={20} fill="currentColor" className="ml-0.5" />
                            )}
                        </button>

                        <div className="flex flex-col items-end">
                            <span className="font-mono text-xs font-medium text-[var(--text-secondary)] tabular-nums tracking-wide">
                                {formatTime(currentTime)}{" "}
                                <span className="text-[var(--text-tertiary)] mx-0.5">/</span>{" "}
                                <span className="text-[var(--text-tertiary)]">
                                    {duration > 0 ? formatTime(duration) : "--:--"}
                                </span>
                            </span>
                            <span className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest mt-0.5 opacity-80">
                                {isPlaying ? "Playing" : "Ready"}
                            </span>
                        </div>
                    </div>

                    {/* Bottom Row: Interactive Scrubber */}
                    <div
                        ref={progressRef}
                        className="relative w-full h-5 flex items-center group cursor-pointer mt-1"
                        onMouseMove={handleHoverMove}
                        onMouseEnter={() => setIsHovering(true)}
                        onMouseLeave={() => setIsHovering(false)}
                        onMouseDown={handleScrubberMouseDown}
                    >
                        {/* Tooltip */}
                        <div
                            className={cn(
                                "absolute bottom-full mb-3 px-2 py-1 rounded bg-[var(--text-primary)] text-[10px] font-mono text-[var(--bg-main)] shadow-sm pointer-events-none transition-opacity duration-200 z-30",
                                isHovering ? "opacity-100" : "opacity-0"
                            )}
                            style={{
                                left: `${duration > 0 ? (hoverTime / duration) * 100 : 0}%`,
                                transform: "translateX(-50%)",
                            }}
                        >
                            {formatTime(hoverTime)}
                        </div>

                        {/* Track Background - Darker for visibility on white */}
                        <div className="absolute w-full h-[4px] bg-[var(--border-focus)] rounded-full overflow-hidden group-hover:h-[6px] transition-all">
                            {/* Progress Fill */}
                            <div
                                className="h-full bg-[image:var(--brand-gradient)] shadow-sm transition-all duration-100 ease-linear"
                                style={{ width: `${progressPercent}%` }}
                            />
                        </div>

                        {/* Thumb Indicator - White with Shadow, visible on track */}
                        <div
                            className={cn(
                                "absolute h-3.5 w-3.5 bg-white border border-[var(--border-subtle)] rounded-full shadow-md ml-[-7px] pointer-events-none transition-all duration-100 ease-linear",
                                isHovering || isDragging
                                    ? "scale-100 opacity-100"
                                    : "scale-0 opacity-0"
                            )}
                            style={{ left: `${progressPercent}%` }}
                        />
                    </div>
                </div>

                {/* Hidden Audio Element */}
                <audio
                    ref={audioRef}
                    src={streamUrl}
                    preload="metadata"
                    crossOrigin="use-credentials" // Sends cookies AND allows Web Audio API access (with backend support)
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleLoadedMetadata}
                    onDurationChange={handleLoadedMetadata}
                    onEnded={() => setIsPlaying(false)}
                    onError={handleAudioError}
                />
            </div>
        );
    }
);

EmberPlayer.displayName = "EmberPlayer";
