import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Maximize2, Minimize2, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m + ":" + String(s).padStart(2, "0");
}

/**
 * 轻量视频播放器：用 Button + Slider 拼控件，替代原生 controls。
 * 面向扩展内直接可播的 progressive mp4。
 */
export function VideoPlayer({
  src,
  autoPlay = false,
  className,
  videoClassName,
}: {
  src: string;
  autoPlay?: boolean;
  className?: string;
  videoClassName?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hideTimer = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [volume, setVolume] = useState(1);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
    video.volume = volume;
  }, [muted, volume]);

  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useEffect(() => {
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, []);

  const bumpControls = () => {
    setControlsVisible(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    if (!playing) return;
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), 2200);
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  };

  const seekTo = (next: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(next)) return;
    video.currentTime = Math.min(Math.max(0, next), duration || video.duration || 0);
    setCurrent(video.currentTime);
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    const next = !video.muted;
    video.muted = next;
    setMuted(next);
    if (!next && video.volume === 0) {
      video.volume = 0.6;
      setVolume(0.6);
    }
  };

  const toggleFullscreen = async () => {
    const root = rootRef.current;
    if (!root) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.requestFullscreen();
    } catch {
      /* noop */
    }
  };

  const stopBubble = (event: PointerEvent) => event.stopPropagation();

  return (
    <div
      ref={rootRef}
      className={cn(
        "group/video relative overflow-hidden rounded-[10px] bg-black select-none",
        className,
      )}
      onMouseMove={bumpControls}
      onPointerDown={stopBubble}
      onClick={(event) => event.stopPropagation()}
    >
      <video
        ref={videoRef}
        key={src}
        src={src}
        playsInline
        autoPlay={autoPlay}
        preload="metadata"
        className={cn("block max-h-full max-w-full bg-black object-contain", videoClassName)}
        onPlay={() => {
          setPlaying(true);
          bumpControls();
        }}
        onPause={() => {
          setPlaying(false);
          setControlsVisible(true);
        }}
        onTimeUpdate={() => setCurrent(videoRef.current?.currentTime || 0)}
        onLoadedMetadata={() => {
          const video = videoRef.current;
          setDuration(video?.duration || 0);
          setCurrent(video?.currentTime || 0);
        }}
        onVolumeChange={() => {
          const video = videoRef.current;
          if (!video) return;
          setMuted(video.muted);
          setVolume(video.volume);
        }}
        onClick={togglePlay}
      />

      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-2.5 pt-8 pb-2.5 transition-opacity duration-200",
          controlsVisible ? "opacity-100" : "opacity-0",
        )}
      >
        <div className="pointer-events-auto flex flex-col gap-1.5">
          <Slider
            min={0}
            max={Math.max(1, duration)}
            step={0.1}
            value={[Math.min(current, duration || 0)]}
            onValueChange={(value) => seekTo(Number(value[0] || 0))}
            aria-label="播放进度"
            className="**:data-[slot=slider-track]:h-1 **:data-[slot=slider-track]:bg-white/25 **:data-[slot=slider-range]:bg-white **:data-[slot=slider-thumb]:size-3 **:data-[slot=slider-thumb]:border-white **:data-[slot=slider-thumb]:bg-white"
          />
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 rounded-full text-white hover:bg-white/15 hover:text-white"
              aria-label={playing ? "暂停" : "播放"}
              onClick={togglePlay}
            >
              {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
            </Button>
            <span className="tnum px-1 text-[11px] font-medium tracking-wide text-white/85">
              {formatTime(current)} / {formatTime(duration)}
            </span>
            <div className="ml-auto flex items-center gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 rounded-full text-white hover:bg-white/15 hover:text-white"
                aria-label={muted || volume === 0 ? "取消静音" : "静音"}
                onClick={toggleMute}
              >
                {muted || volume === 0 ? <VolumeX /> : <Volume2 />}
              </Button>
              <div className="hidden w-20 items-center px-1 sm:flex">
                <Slider
                  min={0}
                  max={1}
                  step={0.05}
                  value={[muted ? 0 : volume]}
                  onValueChange={(value) => {
                    const next = Number(value[0] || 0);
                    setVolume(next);
                    setMuted(next === 0);
                    const video = videoRef.current;
                    if (!video) return;
                    video.volume = next;
                    video.muted = next === 0;
                  }}
                  aria-label="音量"
                  className="**:data-[slot=slider-track]:h-1 **:data-[slot=slider-track]:bg-white/25 **:data-[slot=slider-range]:bg-white **:data-[slot=slider-thumb]:size-3 **:data-[slot=slider-thumb]:border-white **:data-[slot=slider-thumb]:bg-white"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 rounded-full text-white hover:bg-white/15 hover:text-white"
                aria-label={fullscreen ? "退出全屏" : "全屏"}
                onClick={() => void toggleFullscreen()}
              >
                {fullscreen ? <Minimize2 /> : <Maximize2 />}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
