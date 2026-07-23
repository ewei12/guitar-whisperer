"use client";

import { useEffect, useRef, useState } from "react";
import { transcribeAudio } from "./pollTranscription";

const STRING_COLORS: Record<number, string> = {
  1: "#C98B3C",
  2: "#B7792C",
  3: "#8F5B24",
  4: "#65401C",
  5: "#3D2915",
  6: "#161616",
};

const TAB_NAMES: Record<number, string> = {
  1: "e",
  2: "B",
  3: "G",
  4: "D",
  5: "A",
  6: "E",
};

// Standard tuning: MIDI note number of each open string
const STRING_OPEN_MIDI: Record<number, number> = {
  6: 40, // E2
  5: 45, // A2
  4: 50, // D3
  3: 55, // G3
  2: 59, // B3
  1: 64, // E4
};

const BACKEND = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5002";
const TAB_ROW_HEIGHT = 26; // base px at zoom = 1

type ChordEvent = {
  time: number;
  end_time: number;
  chord_name: string | null;
  frets: Record<string, number | null>;
  alternatives?: Record<string, number | null>[];
};

function formatTime(t: number) {
  if (!isFinite(t) || t < 0) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

function downloadBlob(content: BlobPart, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function fretToFrequency(stringNum: number, fret: number) {
  const midi = STRING_OPEN_MIDI[stringNum] + fret;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function FretDiagram({ event }: { event: ChordEvent | undefined }) {
  const width = 230;
  const height = 170;
  const topMargin = 14;
  const bottomMargin = 30;
  const markerMargin = 22;
  const nutX = 46;
  const rightMargin = 14;
  const numFretsShown = 4;
  const stringOrder = [1, 2, 3, 4, 5, 6];

  const stringGap =
    (height - topMargin - bottomMargin) / (stringOrder.length - 1);
  const fretGap = (width - nutX - rightMargin) / numFretsShown;

  const frets = event?.frets;
  const fretValues = frets
    ? (Object.values(frets).filter((f) => f !== null && f > 0) as number[])
    : [];
  const maxFret = fretValues.length ? Math.max(...fretValues) : 0;
  const baseFret = maxFret > numFretsShown ? Math.min(...fretValues) - 1 : 0;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <line
        x1={nutX}
        y1={topMargin}
        x2={nutX}
        y2={height - bottomMargin}
        stroke="#4A2E23"
        strokeWidth={baseFret === 0 ? 4 : 1.5}
      />
      {Array.from({ length: numFretsShown }).map((_, i) => (
        <line
          key={i}
          x1={nutX + fretGap * (i + 1)}
          y1={topMargin}
          x2={nutX + fretGap * (i + 1)}
          y2={height - bottomMargin}
          stroke="#D8C4A0"
          strokeWidth={1}
        />
      ))}
      {stringOrder.map((s, idx) => {
        const y = topMargin + idx * stringGap;
        return (
          <line
            key={s}
            x1={nutX}
            y1={y}
            x2={width - rightMargin}
            y2={y}
            stroke={STRING_COLORS[s]}
            strokeWidth={2}
          />
        );
      })}
      {frets &&
        stringOrder.map((s, idx) => {
          const y = topMargin + idx * stringGap;
          const fret = frets[String(s)];
          if (fret === null || fret === undefined) {
            return (
              <text
                key={`m-${s}`}
                x={markerMargin}
                y={y + 4}
                textAnchor="middle"
                fontSize={13}
                fill="#8A342A"
              >
                ×
              </text>
            );
          }
          if (fret === 0) {
            return (
              <circle
                key={`o-${s}`}
                cx={markerMargin}
                cy={y}
                r={5}
                fill="none"
                stroke="#4A2E23"
                strokeWidth={1.5}
              />
            );
          }
          const relFret = fret - baseFret;
          const x = nutX + fretGap * (relFret - 0.5);
          return (
            <circle
              key={`d-${s}`}
              cx={x}
              cy={y}
              r={9}
              fill={STRING_COLORS[s]}
            />
          );
        })}
      {baseFret > 0 && (
        <text
          x={nutX + fretGap * 0.5}
          y={height - 10}
          textAnchor="middle"
          fontSize={11}
          fill="#7A6A56"
        >
          {baseFret + 1}fr
        </text>
      )}
    </svg>
  );
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("");
  const [notes, setNotes] = useState<any[]>([]);
  const [events, setEvents] = useState<ChordEvent[]>([]);
  const [audioUrl, setAudioUrl] = useState("");
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState("");
  const [tabCurrentTime, setTabCurrentTime] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  // --- new feature state ---
  const [playbackRate, setPlaybackRate] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [editMode, setEditMode] = useState(false);
  const [editedFrets, setEditedFrets] = useState<
    Record<number, Record<string, number | null>>
  >({});
  const [selectedAlt, setSelectedAlt] = useState<Record<number, number>>({});
  const [editingCell, setEditingCell] = useState<{
    index: number;
    string: number;
  } | null>(null);

  // --- tab audio playback (synthesized, fully independent of song audio) ---
  const [isTabPlaying, setIsTabPlaying] = useState(false);
  const [tabActiveIndex, setTabActiveIndex] = useState<number | null>(null);
  const [tabPlaybackRate, setTabPlaybackRate] = useState(1);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const tabNodesRef = useRef<OscillatorNode[]>([]);
  const tabAnimRef = useRef<number | null>(null);

  async function uploadAudio() {
    if (!file) return;

    stopTabAudio();

    setLoading(true);
    setError("");
    setTab("");
    setNotes([]);
    setEvents([]);
    setAudioUrl("");
    setDuration(0);
    setCurrentTime(0);
    setTabCurrentTime(0);
    setIsPlaying(false);
    setPlaybackRate(1);
    setZoom(1);
    setEditMode(false);
    setEditedFrets({});
    setSelectedAlt({});
    setEditingCell(null);

    const formData = new FormData();
    formData.append("audio", file);
    formData.append("separation_mode", "none");

    try {
      const result = await transcribeAudio(formData, BACKEND);
      setTab(result.tab);
      setNotes(result.notes || []);
      setEvents(result.events || []);
      setDuration(result.duration || 0);
      if (result.audio_url) setAudioUrl(`${BACKEND}${result.audio_url}`);
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't reach the backend. Check the server is running.",
      );
    }

    setLoading(false);
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play();
    } else {
      audio.pause();
    }
  }

  function seekTo(t: number) {
    const audio = audioRef.current;
    if (audio) audio.currentTime = t;
    setCurrentTime(t);
  }

  // when the tab is playing, the fretboard/highlighted column follows the tab;
  // otherwise it follows the song's scrub position. The two are independent.
  const activeIndex =
    isTabPlaying && tabActiveIndex !== null
      ? tabActiveIndex
      : events.reduce((acc, ev, i) => (currentTime >= ev.time ? i : acc), 0);
  const activeEvent = events[activeIndex];

  function jumpToChord(direction: 1 | -1) {
    if (events.length === 0) return;
    const next = Math.min(
      events.length - 1,
      Math.max(0, activeIndex + direction),
    );
    seekTo(events[next].time);
  }

  function getEffectiveFrets(
    ev: ChordEvent,
    index: number,
  ): Record<string, number | null> {
    const altIdx = selectedAlt[index] ?? 0;
    const base =
      ev.alternatives && ev.alternatives[altIdx]
        ? ev.alternatives[altIdx]
        : ev.frets;
    const overrides = editedFrets[index];
    return overrides ? { ...base, ...overrides } : base;
  }

  function cycleAlternative(index: number, altCount: number) {
    setSelectedAlt((prev) => {
      const cur = prev[index] ?? 0;
      return { ...prev, [index]: (cur + 1) % altCount };
    });
  }

  function commitFretEdit(index: number, stringNum: number, raw: string) {
    setEditedFrets((prev) => {
      const trimmed = raw.trim();
      const forThisEvent = { ...(prev[index] || {}) };
      if (trimmed === "" || trimmed === "-" || trimmed.toLowerCase() === "x") {
        forThisEvent[String(stringNum)] = null;
      } else {
        const n = parseInt(trimmed, 10);
        if (!isNaN(n) && n >= 0 && n <= 24) {
          forThisEvent[String(stringNum)] = n;
        }
      }
      return { ...prev, [index]: forThisEvent };
    });
    setEditingCell(null);
  }

  function handleColumnClick(ev: ChordEvent, e: React.MouseEvent) {
    seekTo(ev.time);
  }

  // --- synthesized tab playback: its own transport, own scrub position,
  // never touches the <audio> element or the song's currentTime ---
  function stopTabAudio() {
    tabNodesRef.current.forEach((osc) => {
      try {
        osc.stop();
      } catch {
        // already stopped
      }
    });
    tabNodesRef.current = [];
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (tabAnimRef.current !== null) {
      cancelAnimationFrame(tabAnimRef.current);
      tabAnimRef.current = null;
    }
    setIsTabPlaying(false);
    setTabActiveIndex(null);
  }

  function playTabAudio(fromTime = 0) {
    if (events.length === 0) return;

    stopTabAudio();

    const startIndex = Math.max(
      0,
      events.reduce((acc, ev, i) => (ev.time <= fromTime ? i : acc), 0),
    );

    const AudioContextClass =
      window.AudioContext || (window as any).webkitAudioContext;
    const ctx: AudioContext = new AudioContextClass();
    audioCtxRef.current = ctx;

    const rate = tabPlaybackRate;
    const startAt = ctx.currentTime + 0.08;
    const anchorTime = events[startIndex].time;
    const schedule: { index: number; start: number; end: number }[] = [];

    const slice = events.slice(startIndex);
    slice.forEach((ev, offset) => {
      const i = startIndex + offset;
      const frets = getEffectiveFrets(ev, i);
      const rawDur = Math.max(0.12, (ev.end_time ?? ev.time) - ev.time);
      const dur = rawDur / rate;
      const noteStart = startAt + (ev.time - anchorTime) / rate;
      schedule.push({ index: i, start: noteStart, end: noteStart + dur });

      [1, 2, 3, 4, 5, 6].forEach((s) => {
        const fret = frets[String(s)];
        if (fret === null || fret === undefined) return;
        const freq = fretToFrequency(s, fret);

        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = freq;

        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 2800;

        const gain = ctx.createGain();
        const peak = 0.16;
        gain.gain.setValueAtTime(0.0001, noteStart);
        gain.gain.exponentialRampToValueAtTime(peak, noteStart + 0.012);
        gain.gain.exponentialRampToValueAtTime(
          0.0001,
          noteStart + Math.max(dur, 0.05),
        );

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        osc.start(noteStart);
        osc.stop(noteStart + dur + 0.08);
        tabNodesRef.current.push(osc);
      });
    });

    setIsTabPlaying(true);
    setTabCurrentTime(fromTime);

    const totalEnd = startAt + (duration - anchorTime) / rate;
    function tick() {
      if (!audioCtxRef.current) return;
      const now = audioCtxRef.current.currentTime;
      const elapsed = now - startAt;
      const songTime = anchorTime + elapsed * rate;
      setTabCurrentTime(Math.min(songTime, duration));

      const current = schedule.find((s) => now >= s.start && now < s.end);
      if (current) setTabActiveIndex(current.index);

      if (now < totalEnd) {
        tabAnimRef.current = requestAnimationFrame(tick);
      } else {
        stopTabAudio();
        setTabCurrentTime(0);
      }
    }
    tabAnimRef.current = requestAnimationFrame(tick);
  }

  function toggleTabAudio() {
    if (isTabPlaying) {
      stopTabAudio();
    } else {
      playTabAudio(tabCurrentTime);
    }
  }

  function seekTab(t: number) {
    const wasPlaying = isTabPlaying;
    stopTabAudio();
    setTabCurrentTime(t);
    if (wasPlaying) playTabAudio(t);
  }

  // apply playback speed to the audio element
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  // stop any scheduled tab audio on unmount
  useEffect(() => {
    return () => stopTabAudio();
  }, []);

  // keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        jumpToChord(1);
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        jumpToChord(-1);
      } else if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        setZoom((z) => Math.min(2, Math.round((z + 0.1) * 100) / 100));
      } else if (e.key === "-") {
        e.preventDefault();
        setZoom((z) => Math.max(0.6, Math.round((z - 0.1) * 100) / 100));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [events, activeIndex]);

  function exportAsText() {
    const cols = events.map((ev, i) => getEffectiveFrets(ev, i));
    const widths = cols.map((col) =>
      Math.max(
        ...[1, 2, 3, 4, 5, 6].map((s) => String(col[String(s)] ?? "-").length),
      ),
    );
    const lines: string[] = [];
    for (const s of [1, 2, 3, 4, 5, 6]) {
      const cells = cols.map((col, i) =>
        String(col[String(s)] ?? "-").padEnd(widths[i], "-"),
      );
      lines.push(TAB_NAMES[s] + "|-" + cells.join("-") + "-|");
    }
    const header = events
      .map((ev, i) =>
        ev.chord_name && ev.chord_name !== events[i - 1]?.chord_name
          ? ev.chord_name
          : "",
      )
      .filter(Boolean)
      .join("  ");
    downloadBlob(
      `${header}\n\n${lines.join("\n")}\n`,
      "fretwork-tab.txt",
      "text/plain",
    );
  }

  function exportAsPNG() {
    if (events.length === 0) return;
    const cols = events.map((ev, i) => getEffectiveFrets(ev, i));
    const colWidth = 28;
    const leftMargin = 40;
    const topMargin = 40;
    const rowHeight = 26;
    const width = leftMargin + cols.length * colWidth + 20;
    const height = topMargin + 6 * rowHeight + 20;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, width, height);
    ctx.font = "14px monospace";
    ctx.textBaseline = "middle";

    [1, 2, 3, 4, 5, 6].forEach((s, idx) => {
      const y = topMargin + idx * rowHeight;
      ctx.fillStyle = "#111111";
      ctx.fillText(TAB_NAMES[s], 10, y);
      ctx.strokeStyle = "#cccccc";
      ctx.beginPath();
      ctx.moveTo(leftMargin, y);
      ctx.lineTo(width - 10, y);
      ctx.stroke();

      cols.forEach((col, i) => {
        const val = col[String(s)];
        ctx.fillStyle = "#D94827";
        ctx.fillText(
          val === null || val === undefined ? "-" : String(val),
          leftMargin + i * colWidth,
          y,
        );
      });
    });

    events.forEach((ev, i) => {
      if (ev.chord_name && ev.chord_name !== events[i - 1]?.chord_name) {
        ctx.fillStyle = "#111111";
        ctx.font = "11px sans-serif";
        ctx.fillText(ev.chord_name, leftMargin + i * colWidth, 14);
        ctx.font = "14px monospace";
      }
    });

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "fretwork-tab.png";
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  return (
    <main
      className="min-h-screen relative"
      style={{
        background: "#F5F4EF",
        backgroundImage:
          "radial-gradient(circle at 20% 30%, rgba(0,0,0,0.03) 0%, transparent 40%), radial-gradient(circle at 80% 70%, rgba(0,0,0,0.03) 0%, transparent 40%), radial-gradient(circle at 50% 90%, rgba(0,0,0,0.025) 0%, transparent 50%)",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Gabarito:wght@400;500;600;700;800;900&family=IBM+Plex+Mono:wght@400;500&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&display=swap');

        body { font-family: 'Gabarito', serif; }
        .mono { font-family: 'DM Mono', monospace; }
        .handwrite { font-family: 'Gabarito', sans-serif; }
        .paper-font { font-family: 'Gabarito', sans-serif; }

        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spinning { animation: spin 2.4s linear infinite; }
        input[type="range"].scrub { accent-color: #4a3a30; }
        kbd {
          display: inline-block;
          padding: 2px 7px;
          font-family: 'SF Mono', Menlo, Consolas, monospace;
          font-size: 11px;
          font-weight: 500;
          color: #3A2A1C;
          background: #FBF6EC;
          border: 1px solid #D8C4A0;
          border-bottom-width: 2.5px;
          border-radius: 4px;
          box-shadow: 0 1px 0 rgba(0,0,0,0.06);
        }
      `}</style>

      <div className="absolute top-6 left-6 flex items-center gap-3 z-10">
        <span
          className="text-lg"
          style={{ fontFamily: "var(--font-stack-notch)", userSelect: "none" }}
        >
          guitar whisperer
        </span>
      </div>

      <div className="max-w-5xl mx-auto px-8 pt-16 pb-24">
        <div className="mb-14 text-center">
          <h1
            className="text-5xl font-black leading-none mb-3"
            style={{
              fontFamily: "var(--font-stack-notch)",
              color: "#111",
              letterSpacing: "-0.05em",
            }}
          >
            Turn audio into guitar tabs.
          </h1>
          <p className="text-lg" style={{ color: "#666" }}>
            Upload a song & get playable chords and tablature.
          </p>
        </div>

        <div className="mx-auto mb-10" style={{ maxWidth: "750px" }}>
          <div
            className="p-6"
            style={{
              background: "#fffbf7",
              border: "3px solid #111",
              boxShadow: "6px 6px 0 #111",
            }}
          >
            <label
              className="
                flex
                items-center
                justify-center
                gap-5
                py-6
                px-5
                rounded-lg
                cursor-pointer
                transition-colors
                duration-200
                hover:bg-[#f6ece5]
                min-h-[120px]
              "
              style={{
                border: "1px dashed #c69c7e",
              }}
            >
              <img
                className="rounded-lg transition-transform duration-200 group-hover:scale-110"
                src="/upload.svg"
                alt="Upload"
                width={52}
                height={52}
              />
              <div className="min-w-0">
                <p className="text-xl truncate" style={{ color: "#3A2A1C" }}>
                  {file ? file.name : "pick an audio file"}
                </p>
                <p
                  className="handwrite text-xs italic"
                  style={{ color: "#9A8567" }}
                >
                  {file ? "" : "wav, mp3, m4a, mp4"}
                </p>
              </div>
              <input
                type="file"
                accept="audio/*"
                onChange={(e) => {
                  if (e.target.files) setFile(e.target.files[0]);
                }}
                className="hidden"
              />
            </label>

            <button
              onClick={uploadAudio}
              disabled={!file || loading}
              className="w-full mt-6 py-4 text-lg font-bold uppercase rounded-lg transition-all duration-300"
              style={{
                background: !file ? "#ddd" : "#111",
                color: !file ? "#999" : "#fff",
                border: "none",
                cursor: !file || loading ? "not-allowed" : "pointer",
                fontFamily: "var(--font-stack-notch)",
                letterSpacing: "0.08em",
                filter: loading ? "brightness(1)" : undefined,
              }}
              onMouseEnter={(e) => {
                if (file && !loading)
                  e.currentTarget.style.filter = "brightness(1.1)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.filter = "brightness(1)";
              }}
            >
              <span className="inline-flex items-center justify-center gap-2.5">
                {loading && (
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "#fff",
                      animation: "pulse 1.2s ease-in-out infinite",
                    }}
                  />
                )}
                <span
                  style={{
                    opacity: loading ? 0.85 : 1,
                    transition: "opacity 0.3s",
                  }}
                >
                  {loading ? "listening" : "create tab"}
                </span>
              </span>
            </button>

            <style>{`
  @keyframes pulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50%      { transform: scale(1); opacity: 0.3; }
  }
`}</style>
          </div>
        </div>

        {error && (
          <div
            className="mx-auto mb-8 px-5 py-4 text-sm"
            style={{
              maxWidth: "460px",
              background: "#F4E3DC",
              border: "1px solid #D6A98F",
              color: "#8A342A",
            }}
          >
            {error}
          </div>
        )}

        {(tab || audioUrl) && (
          <section className="mb-10">
            <p
              className="handwrite text-2xl mb-2 ml-2"
              style={{ color: "#4A2E23" }}
            >
              {/* {isolated && (
                <span className="text-base" style={{ color: "#7A6A56" }}>
                  {" "}
                  ({isolated} isolated)
                </span>
              )} */}
            </p>

            {audioUrl && (
              <audio
                ref={audioRef}
                src={audioUrl}
                onTimeUpdate={(e) => {
                  const t = e.currentTarget.currentTime;
                  setCurrentTime(t);
                }}
                onLoadedMetadata={(e) => {
                  if (!duration && isFinite(e.currentTarget.duration)) {
                    setDuration(e.currentTarget.duration);
                  }
                }}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
                style={{ display: "none" }}
              />
            )}

            {/* row of fret and guitar tab */}
            {events.length > 0 ? (
              <div
                className="flex items-start gap-4 mb-2"
                style={{
                  width: "100vw",
                  marginLeft: "calc(50% - 50vw)",
                  padding: "0 24px",
                  boxSizing: "border-box",
                }}
              >
                {/* fretboard — fixed width, doesn't scroll */}
                <div className="flex flex-col items-center flex-shrink-0">
                  <div
                    className="p-6"
                    style={{
                      background: "#ffffff",
                      border: "1px solid #cdcdcd",
                    }}
                  >
                    <FretDiagram event={activeEvent} />
                  </div>
                  <p
                    className="text-3xl font-black mt-4"
                    style={{ color: "#D94827" }}
                  >
                    {activeEvent?.chord_name || ""}
                  </p>
                </div>

                {/* guitar tab area */}
                <div
                  className="p-6 relative overflow-x-auto flex-1 min-w-0"
                  style={{
                    background: "#FFFFFF",
                    border: "1px solid #cdcdcd",
                  }}
                >
                  <div className="flex" style={{ minWidth: "max-content" }}>
                    <div className="flex flex-col items-center px-2 py-1 mr-2">
                      <div style={{ height: 22 * zoom }} />
                      {[1, 2, 3, 4, 5, 6].map((s) => (
                        // string letters
                        <div
                          key={s}
                          className="handwrite text-lg flex items-center justify-center"
                          style={{
                            color: STRING_COLORS[s],
                            height: TAB_ROW_HEIGHT * zoom,
                          }}
                        >
                          {TAB_NAMES[s]}
                        </div>
                      ))}
                    </div>

                    {events.map((ev, i) => {
                      const effectiveFrets = getEffectiveFrets(ev, i);
                      const showLabel =
                        !!ev.chord_name &&
                        ev.chord_name !== events[i - 1]?.chord_name;
                      const altCount = ev.alternatives?.length ?? 1;

                      return (
                        <div
                          key={i}
                          className="flex flex-col items-center px-2 py-1 mx-0.5"
                          style={{ position: "relative" }}
                        >
                          <div
                            className="handwrite"
                            style={{
                              height: 22 * zoom,
                              lineHeight: `${22 * zoom}px`,
                              fontSize: 16 * zoom,
                              color: "#8A342A",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {showLabel ? ev.chord_name : ""}
                          </div>

                          {/* highlight bar */}
                          <button
                            onClick={(e) => handleColumnClick(ev, e)}
                            className="flex flex-col items-center"
                            style={{
                              position: "relative",
                              background:
                                i === activeIndex
                                  ? "rgba(217,72,39,0.15)"
                                  : "transparent",
                              cursor: "pointer",
                              borderRadius: 4,
                              padding: "4px 8px",
                              margin: "0 -8px",
                            }}
                            title={ev.chord_name || undefined}
                          >
                            {[1, 2, 3, 4, 5, 6].map((s) => {
                              const val = effectiveFrets[String(s)];
                              const isEditing =
                                editingCell?.index === i &&
                                editingCell?.string === s;

                              if (editMode && isEditing) {
                                return (
                                  <input
                                    key={s}
                                    autoFocus
                                    defaultValue={
                                      val === null || val === undefined
                                        ? ""
                                        : String(val)
                                    }
                                    onClick={(e) => e.stopPropagation()}
                                    onBlur={(e) =>
                                      commitFretEdit(i, s, e.target.value)
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter")
                                        (e.target as HTMLInputElement).blur();
                                      if (e.key === "Escape")
                                        setEditingCell(null);
                                    }}
                                    style={{
                                      width: 22,
                                      height: TAB_ROW_HEIGHT * zoom,
                                      fontSize: 12 * zoom,
                                      textAlign: "center",
                                      border: "1px solid #D94827",
                                    }}
                                  />
                                );
                              }

                              const isEdited =
                                editedFrets[i]?.[String(s)] !== undefined;

                              return (
                                <div
                                  key={s}
                                  onClick={(e) => {
                                    if (editMode) {
                                      e.stopPropagation();
                                      setEditingCell({ index: i, string: s });
                                    }
                                  }}
                                  className="text-sm flex items-center justify-center"
                                  style={{
                                    fontFamily:
                                      "'SF Mono', Menlo, Consolas, monospace",
                                    color: isEdited
                                      ? "#1D7A46"
                                      : STRING_COLORS[s],
                                    height: TAB_ROW_HEIGHT * zoom,
                                    fontSize: 13 * zoom,
                                    cursor: editMode ? "text" : "pointer",
                                    textDecoration: editMode
                                      ? "underline dotted"
                                      : "none",
                                  }}
                                >
                                  {val ?? "-"}
                                </div>
                              );
                            })}
                          </button>

                          {altCount > 1 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                cycleAlternative(i, altCount);
                              }}
                              title={`voicing ${(selectedAlt[i] ?? 0) + 1}/${altCount} — click to cycle`}
                              className="text-[10px] mt-1"
                              style={{
                                color: "#000000",
                                background: "#fff",
                                border: "1px solid #000000",
                                borderRadius: 3,
                                cursor: "pointer",
                                padding: "0 3px",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 2,
                                flexShrink: 0,
                                flexGrow: 0,
                                whiteSpace: "nowrap",
                              }}
                            >
                              <img
                                src="/swap.svg"
                                width={12}
                                height={12}
                                style={{ width: 12, height: 12, flexShrink: 0 }}
                                alt="Cycle voicing"
                              />
                              {(selectedAlt[i] ?? 0) + 1}/{altCount}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              tab && (
                <div
                  className="p-6 relative"
                  style={{
                    background: "#FBF6EC",
                    border: "1px solid #D8C4A0",
                    boxShadow: "0 3px 8px rgba(0,0,0,0.1)",
                    backgroundImage:
                      "repeating-linear-gradient(180deg, transparent, transparent 27px, rgba(138,106,61,0.12) 28px)",
                  }}
                >
                  <pre
                    className="overflow-x-auto text-sm leading-7"
                    style={{
                      color: "#3A2A1C",
                      fontFamily: "'SF Mono', Menlo, Consolas, monospace",
                      background: "none",
                    }}
                  >
                    {tab}
                  </pre>
                </div>
              )
            )}

            {/* --- song player (your original recording) --- */}
            {audioUrl && (
              <div
                className="p-4 mb-4 rounded-lg"
                style={{
                  background: "#FFFFFF",
                  border: "1px solid #111",
                  boxShadow: "4px 4px 0 #111",
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <p
                    className="text-xs uppercase tracking-widest mb-2"
                    style={{ color: "#666" }}
                  >
                    your recording
                  </p>
                  <div className="flex items-center gap-2">
                    <span
                      className="text-xs uppercase tracking-widest"
                      style={{ color: "#666" }}
                    >
                      Song Speed
                    </span>
                    {[0.5, 0.75, 1, 1.25, 1.5].map((r) => (
                      <button
                        key={r}
                        onClick={() => setPlaybackRate(r)}
                        className="text-xs px-2 py-1"
                        style={{
                          background: playbackRate === r ? "#111" : "#fff",
                          color: playbackRate === r ? "#fff" : "#111",
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
                    onClick={togglePlay}
                    className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{
                      // your recording play button
                      background: "#000000",
                      color: "#FBF6EC",
                      border: "none",
                      cursor: "pointer",
                    }}
                    aria-label={isPlaying ? "pause" : "play"}
                  >
                    {isPlaying ? "❚❚" : "▶"}
                  </button>
                  <input
                    className="scrub flex-1"
                    type="range"
                    min={0}
                    max={duration || 0}
                    step={0.01}
                    value={currentTime}
                    onChange={(e) => seekTo(parseFloat(e.target.value))}
                  />
                  <span
                    className="handwrite text-lg flex-shrink-0"
                    style={{
                      color: "#7A6A56",
                      minWidth: "72px",
                      textAlign: "right",
                    }}
                  >
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>
                </div>
              </div>
            )}

            {/* --- tab player (synthesized transcription) --- */}
            {events.length > 0 && (
              <div
                className="p-4 mb-4 rounded-lg"
                style={{
                  background: "#FBF6EC",
                  border: "1px solid #111",
                  boxShadow: "4px 4px 0 #111",
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <p
                    className="text-xs uppercase tracking-widest"
                    style={{ color: "#9A8567" }}
                  >
                    transcribed tab
                  </p>
                  <div className="flex items-center gap-1">
                    <span
                      className="text-xs uppercase tracking-widest mr-1"
                      style={{ color: "#9A8567" }}
                    >
                      tab speed
                    </span>
                    {[0.5, 0.75, 1, 1.25, 1.5].map((r) => (
                      <button
                        key={r}
                        onClick={() => setTabPlaybackRate(r)}
                        className="text-xs px-2 py-1"
                        style={{
                          background: tabPlaybackRate === r ? "#111" : "#fff",
                          color: tabPlaybackRate === r ? "#fff" : "#111",
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
                    onClick={toggleTabAudio}
                    className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{
                      // transcribed tab play button
                      background: "#000000",
                      color: "#FBF6EC",
                      border: "none",
                      cursor: "pointer",
                    }}
                    aria-label={
                      isTabPlaying ? "pause tab audio" : "play tab audio"
                    }
                    title="Play back the transcribed tab as synthesized notes — independent of the song audio above"
                  >
                    {isTabPlaying ? "❚❚" : "▶"}
                  </button>
                  <input
                    className="scrub flex-1"
                    type="range"
                    min={0}
                    max={duration || 0}
                    step={0.01}
                    value={tabCurrentTime}
                    onChange={(e) => seekTab(parseFloat(e.target.value))}
                  />
                  <span
                    className="handwrite text-lg flex-shrink-0"
                    style={{
                      color: "#7A6A56",
                      minWidth: "72px",
                      textAlign: "right",
                    }}
                  >
                    {formatTime(tabCurrentTime)} / {formatTime(duration)}
                  </span>
                </div>
              </div>
            )}

            {/* start of controls bar */}
            {events.length > 0 && (
              <>
                <div
                  className="p-4 mb-4 flex flex-wrap items-center gap-4 rounded-lg"
                  style={{
                    background: "#FFFFFF",
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="text-xs uppercase tracking-widest"
                      style={{ color: "#666" }}
                    >
                      Zoom
                    </span>
                    <button
                      onClick={() =>
                        setZoom((z) =>
                          Math.max(0.6, Math.round((z - 0.1) * 100) / 100),
                        )
                      }
                      style={{
                        border: "1px solid #111",
                        background: "#fff",
                        width: 24,
                        cursor: "pointer",
                      }}
                    >
                      -
                    </button>
                    <span
                      className="text-xs"
                      style={{ minWidth: 36, textAlign: "center" }}
                    >
                      {Math.round(zoom * 100)}%
                    </span>
                    <button
                      onClick={() =>
                        setZoom((z) =>
                          Math.min(2, Math.round((z + 0.1) * 100) / 100),
                        )
                      }
                      style={{
                        border: "1px solid #111",
                        background: "#fff",
                        width: 24,
                        cursor: "pointer",
                      }}
                    >
                      +
                    </button>
                  </div>

                  <button
                    onClick={() => setEditMode((v) => !v)}
                    className="text-xs px-2 py-1"
                    style={{
                      background: editMode ? "#1D7A46" : "#fff",
                      color: editMode ? "#fff" : "#111",
                      border: "1px solid #111",
                      cursor: "pointer",
                    }}
                  >
                    {editMode ? "editing tab" : "edit tab"}
                  </button>

                  <div className="flex items-center gap-2 ml-auto">
                    <span
                      className="text-xs uppercase tracking-widest"
                      style={{ color: "#666" }}
                    >
                      Export
                    </span>
                    <button
                      onClick={exportAsText}
                      className="text-xs px-2 py-1"
                      style={{
                        border: "1px solid #111",
                        background: "#fff",
                        cursor: "pointer",
                      }}
                    >
                      .txt
                    </button>

                    <button
                      onClick={exportAsPNG}
                      className="text-xs px-2 py-1"
                      style={{
                        border: "1px solid #111",
                        background: "#fff",
                        cursor: "pointer",
                      }}
                    >
                      .png
                    </button>
                  </div>
                </div>

                <div
                  className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mb-4 px-1"
                  style={{ rowGap: 6 }}
                >
                  <span
                    className="flex items-center gap-1.5 text-xs whitespace-nowrap"
                    style={{ color: "#8A7B63" }}
                  >
                    <kbd>Space</kbd> play / pause song
                  </span>
                  <span
                    className="flex items-center gap-1.5 text-xs whitespace-nowrap"
                    style={{ color: "#8A7B63" }}
                  >
                    <kbd>←</kbd>
                    <kbd>→</kbd> chord
                  </span>
                  <span
                    className="flex items-center gap-1.5 text-xs whitespace-nowrap"
                    style={{ color: "#8A7B63" }}
                  >
                    <kbd>+</kbd>
                    <kbd>-</kbd> zoom
                  </span>
                </div>
              </>
            )}
          </section>
        )}

        {notes.length > 0 && (
          <section>
            <p
              className="handwrite text-2xl mb-3 ml-2"
              style={{ color: "#4A2E23" }}
            >
              note by note
            </p>
            <div className="grid md:grid-cols-3 gap-4">
              {notes.map((note, index) => (
                <div
                  key={index}
                  className="relative p-4"
                  style={{
                    background: "#FBF6EC",
                    border: "1px solid #D8C4A0",
                    boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
                  }}
                >
                  <div
                    style={{
                      background: STRING_COLORS[note.string] ?? "#8A6A3D",
                    }}
                  />
                  <div
                    className="paper-font text-lg"
                    style={{
                      color: STRING_COLORS[note.string] ?? "#3A2A1C",
                      fontWeight: 500,
                    }}
                  >
                    {note.note}
                  </div>
                  <div className="text-sm mt-1" style={{ color: "#7A6A56" }}>
                    string {note.string} · fret {note.fret}
                  </div>
                  <div
                    className="handwrite text-base"
                    style={{ color: "#9A8567" }}
                  >
                    {note.time}s in
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
