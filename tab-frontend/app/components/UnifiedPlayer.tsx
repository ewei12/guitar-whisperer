import { useState } from "react";
import { formatTime } from "./functionsOnly";

type Source = "song" | "tab";

export function UnifiedPlayer({
    source,
    setSource,
    isPlaying,
    // song engine
    currentTime,
    duration,
    playbackRate,
    onTogglePlay,
    onSeek,
    onRateChange,
    // tab engine
    isTabPlaying,
    tabCurrentTime,
    tabPlaybackRate,
    onToggleTabAudio,
    onSeekTab,
    onTabRateChange,
}: {
    source: "song" | "tab";
    setSource: (s: "song" | "tab") => void;
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    playbackRate: number;
    onTogglePlay: () => void;
    onSeek: (t: number) => void;
    onRateChange: (r: number) => void;
    isTabPlaying: boolean;
    tabCurrentTime: number;
    tabPlaybackRate: number;
    onToggleTabAudio: () => void;
    onSeekTab: (t: number) => void;
    onTabRateChange: (r: number) => void;
}) {
    const isSong = source === "song";

    // Pause whichever engine isn't active when switching, so you never
    // have both sources playing simultaneously underneath the single UI.
    function switchTo(next: Source) {
        if (next === source) return;
        if (isSong && isPlaying) onTogglePlay();
        if (!isSong && isTabPlaying) onToggleTabAudio();
        setSource(next);
        }

    const active = isSong
    ? {
        playing: isPlaying,
        time: currentTime,
        rate: playbackRate,
        toggle: onTogglePlay,
        seek: onSeek,
        setRate: onRateChange,
      }
    : {
        playing: isTabPlaying,
        time: tabCurrentTime,
        rate: tabPlaybackRate,
        toggle: onToggleTabAudio,
        seek: onSeekTab,
        setRate: onTabRateChange,
      };
    return (
        <div
            className="p-4 mb-4 rounded-lg print-hide"
            style={{
            background: "#FFFFFF",
            border: "1px solid #111",
            boxShadow: "4px 4px 0 #111",
            }}
        >
            <div className="flex items-center justify-between mb-3">
                <div
                style={{
                    display: "inline-flex",
                    border: "1px solid #111",
                    borderRadius: 999,
                    overflow: "hidden",
                }}
                >
            <button
                onClick={() => switchTo("song")}
                className="text-xs px-3 py-1"
                style={{
                background: isSong ? "#111" : "#fff",
                color: isSong ? "#fff" : "#111",
                cursor: "pointer",
                border: "none",
                }}
            >
                recording
            </button>
            <button
                onClick={() => switchTo("tab")}
                className="text-xs px-3 py-1"
                style={{
                background: !isSong ? "#111" : "#fff",
                color: !isSong ? "#fff" : "#111",
                cursor: "pointer",
                border: "none",
                }}
            >
                guitar tab
            </button>
        </div>

        <div className="flex items-center gap-2">
            <span
            className="text-xs uppercase tracking-widest"
            style={{ color: "#666" }}
            >
                speed
            </span>
            {[0.5, 0.75, 1, 1.25, 1.5].map((r) => (
            <button
                key={r}
                onClick={() => active.setRate(r)}
                className="text-xs px-2 py-1"
                style={{
                background: active.rate === r ? "#111" : "#fff",
                color: active.rate === r ? "#fff" : "#111",
                border: "1px solid #111",
                cursor: "pointer",
                }}
            >
                {r}×
            </button>
          ))}
        </div>
        </div>
            <div className="flex items-center gap-4">
                <button
                    onClick={active.toggle}
                    className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 transition-transform duration-150"
                    style={{
                        background: "#4A2E23",
                        border: "none",
                        cursor: "pointer",
                        boxShadow: "0 3px 8px rgba(74,46,35,0.35)",
                    }}
                    onMouseEnter={(e) =>
                        (e.currentTarget.style.transform = "scale(1.03)")
                    }
                    onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
                    onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.96)")}
                    onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1.03)")}
                    aria-label={active.playing ? "pause" : "play"}
                >
                    {active.playing ? (
                        <div className="flex gap-[3px]">
                            <div
                                style={{
                                width: 4,
                                height: 14,
                                borderRadius: 2,
                                background: "#FBF6EC",
                                }}
                            />
                            <div
                                style={{
                                width: 4,
                                height: 14,
                                borderRadius: 2,
                                background: "#FBF6EC",
                                }}
                            />
                        </div>
                    ) : (
                        <div
                            style={{
                                width: 0,
                                height: 0,
                                borderTop: "7px solid transparent",
                                borderBottom: "7px solid transparent",
                                borderLeft: "11px solid #FBF6EC",
                                marginLeft: 3,
                                borderRadius: 2,
                            }}
                        />
                    )}
                </button>
        <input
            className="scrub flex-1"
            type="range"
            min={0}
            max={duration || 0}
            step={0.01}
            value={active.time}
            onChange={(e) => active.seek(parseFloat(e.target.value))}
        />
        <span
            className="handwrite text-lg flex-shrink-0"
            style={{ color: "#7A6A56", minWidth: "72px", textAlign: "right" }}
        >
            {formatTime(active.time)} / {formatTime(duration)}
        </span>
        </div>
    </div>
  );
}
