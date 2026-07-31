"use client";

import { useEffect, useRef, useState } from "react";
import { transcribeAudio } from "./pollTranscription";
import { PrintableTab } from "./components/PrintableTab";
import { ChordEvent, TAB_NAMES } from "./components/chordTypes";
import { validateAudioFile } from "./components/functionsOnly";
import { ErrorBanner } from "./components/errorBanner";
import { ShortcutsHint } from "./components/ShortcutsHint";
import { TabControls } from "./components/TabControls";
import { UnifiedPlayer } from "./components/UnifiedPlayer";
import { DropOverlay } from "./components/DropOverlay";
import { UploadPanel } from "./components/UploadPanel";
import { TabViewer } from "./components/TabViewer";
import { KeyboardShortcuts } from "./components/KeyboardShortcuts";
import { DragAndDrop } from "./components/DragAndDrop";
import { SynthPlayer } from "./components/SynthPlayer";
import { exportTabAsPDF } from "./components/exportTabPdf";
import { useFretEditor } from "./components/FretEditor";


const BACKEND = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5002";

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("");
  const [events, setEvents] = useState<ChordEvent[]>([]);
  const [audioUrl, setAudioUrl] = useState("");
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [playerSource, setPlayerSource] = useState<"song" | "tab">("song");

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  // --- new feature state ---
  const [playbackRate, setPlaybackRate] = useState(1);
  const [zoom, setZoom] = useState(1);

  // --- tab audio playback (synthesized, fully independent of song audio) ---
  const tabScrollRef = useRef<HTMLDivElement>(null);
  const columnRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const [manualIndex, setManualIndex] = useState<number | null>(null);

  const [rateLimited, setRateLimited] = useState<string | null>(null);

  async function uploadAudio() {
    if (!file) return;
    stopTabAudio();
    setLoading(true);
    setError("");
    setTab("");
    setEvents([]);
    setAudioUrl("");
    setDuration(0);
    setCurrentTime(0);
    setIsPlaying(false);
    setPlaybackRate(1);
    setZoom(1);
    setManualIndex(null);
    resetAll();

    const formData = new FormData();
    formData.append("audio", file);
    formData.append("separation_mode", "none");

    try {
      const result = await transcribeAudio(formData, BACKEND);
      setTab(result.tab);
      setEvents(result.events || []);
      setDuration(result.duration || 0);
      if (result.audio_url) setAudioUrl(`${BACKEND}${result.audio_url}`);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Couldn't reach the backend. Check the server is running.";

      if (message.includes("Demo limit reached")) {
        setRateLimited(message);
      } else {
        setError(message);
      }
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
    setManualIndex(null);
  }

  const {
    editMode, setEditMode, editedFrets, setEditedFrets, resetAll,
    selectedAlt, editingCell, setEditingCell,
    getEffectiveFrets, cycleAlternative, commitFretEdit,
  } = useFretEditor();

  const {
    isTabPlaying, tabActiveIndex, tabCurrentTime, tabPlaybackRate,
    setTabPlaybackRate, playTabAudio, stopTabAudio,
    toggleTabAudio: rawToggleTabAudio,
    seekTab: rawSeekTab,
  } = SynthPlayer(events, duration, getEffectiveFrets);

  function seekTab(t: number) {
      rawSeekTab(t);
      setManualIndex(null);
  }

  function toggleTabAudio() {
      if (!isTabPlaying) setManualIndex(null); // starting playback — clear stale index
      rawToggleTabAudio();
  }

  function togglePlayer() {
    if (playerSource === "tab") {
      toggleTabAudio();
    } else {
      togglePlay();
    }
  }

  function jumpToChord(direction: 1 | -1) {
    if (events.length === 0) return;
    const next = Math.min(events.length - 1, Math.max(0, activeIndex + direction));
    if (playerSource === "tab") {
      seekTab(events[next].time);
    } else {
      seekTo(events[next].time);
    }
    setManualIndex(next);
  }

  function handleColumnClick(ev: ChordEvent, e: React.MouseEvent) {
    if (playerSource === "tab") {
      seekTab(ev.time);
    } else {
      seekTo(ev.time);
    }
  }

  const activeIndex =
    playerSource === "tab"
      ? tabActiveIndex !== null
        ? tabActiveIndex
        : manualIndex !== null
        ? manualIndex
        : events.reduce((acc, ev, i) => (tabCurrentTime >= ev.time ? i : acc), 0)
      : manualIndex !== null
      ? manualIndex
      : events.reduce((acc, ev, i) => (currentTime >= ev.time ? i : acc), 0);
  const activeEvent = events[activeIndex];

  // apply playback speed to the audio element
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  // stop any scheduled tab audio on unmount
  useEffect(() => {
    return () => stopTabAudio();
  }, []);

  // keyboard shortcuts
  KeyboardShortcuts({
    onPlayPause: togglePlayer,
    onNext: () => jumpToChord(1),
    onPrev: () => jumpToChord(-1),
    onZoomIn: () => setZoom((z) => Math.min(2, Math.round((z + 0.1) * 100) / 100)),
    onZoomOut: () => setZoom((z) => Math.max(0.6, Math.round((z - 0.1) * 100) / 100)),
  });


  // keep tab position on currently playing chords/notes
  useEffect(() => {
    const container = tabScrollRef.current;
    const col = columnRefs.current[activeIndex];
    if (!container || !col) return;
    const containerRect = container.getBoundingClientRect();
    const colRect = col.getBoundingClientRect();
    const offset =
      colRect.left -
      containerRect.left -
      containerRect.width / 2 +
      colRect.width / 2;
    container.scrollBy({ left: offset, behavior: "smooth" });
  }, [activeIndex]);

  DragAndDrop((dropped) => {
    const validationError = validateAudioFile(dropped);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    setFile(dropped);
  }, setIsDragging);

  return (
    <main
      className="min-h-screen relative paper-texture"
      style={{
        background: "#F5F4EF",
        backgroundImage:
          "radial-gradient(circle at 20% 30%, rgba(0,0,0,0.03) 0%, transparent 40%), radial-gradient(circle at 80% 70%, rgba(0,0,0,0.03) 0%, transparent 40%), radial-gradient(circle at 50% 90%, rgba(0,0,0,0.025) 0%, transparent 50%)",
      }}
    >
      {/* drag and drop over entire screen */}
      <DropOverlay isDragging={isDragging} />

      {/* rate limited overlay */}
      {rateLimited && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{
            background: "rgba(245, 244, 239, 0.92)",
            backdropFilter: "blur(6px)",
          }}
        >
          <div
            className="flex flex-col items-center gap-4 px-10 py-12 text-center max-w-md mx-4"
            style={{
              background: "#FBF6EC",
              border: "1px solid #D8C4A0",
              borderRadius: "10px",
              boxShadow: "0 3px 8px rgba(0,0,0,0.1)",
            }}
          >
            <h2
              className="text-2xl font-black"
              style={{
                fontFamily: "var(--font-stack-notch)",
                color: "#111",
                letterSpacing: "-0.03em",
              }}
            >
              Demo limit reached.
            </h2>
          </div>
        </div>
      )}

      <div className="absolute top-6 left-6 flex items-center gap-3 z-10">
        <span
          className="text-lg"
          style={{ fontFamily: "var(--font-stack-notch)", userSelect: "none" }}
        >
          guitar whisperer
        </span>
      </div>

      <div className="max-w-5xl mx-auto px-8 pt-16 pb-24 relative z-10">
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

        <UploadPanel
          file={file}
          loading={loading}
          isDragging={isDragging}
          onFileChange={(picked) => {
            const validationError = validateAudioFile(picked);
            if (validationError) {
              setError(validationError);
              return;
            }
            setError("");
            setFile(picked);
          }}
          onSubmit={uploadAudio}
        />

        {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}

        {(tab || audioUrl) && (
          <section className="mb-10 print-tab">
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
                onPlay={() => {
                  setIsPlaying(true);
                  setManualIndex(null);
                }}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
                style={{ display: "none" }}
              />
            )}

            {/* row of fret and guitar tab */}
            {events.length > 0 ? (
              <TabViewer
                events={events}
                activeEvent={activeEvent}
                activeIndex={activeIndex}
                zoom={zoom}
                editMode={editMode}
                editedFrets={editedFrets}
                selectedAlt={selectedAlt}
                editingCell={editingCell}
                setEditingCell={setEditingCell}
                getEffectiveFrets={getEffectiveFrets}
                commitFretEdit={commitFretEdit}
                cycleAlternative={cycleAlternative}
                handleColumnClick={handleColumnClick}
                tabScrollRef={tabScrollRef}
                columnRefs={columnRefs}
              />
            ) : (
              tab && (
                <div className="print-hide p-6 relative" style={{ background: "#FBF6EC", border: "1px solid #D8C4A0", boxShadow: "0 3px 8px rgba(0,0,0,0.1)" }}>
                  <pre className="overflow-x-auto text-sm leading-7" style={{ color: "#3A2A1C", fontFamily: "'SF Mono', Menlo, Consolas, monospace", background: "none" }}>
                    {tab}
                  </pre>
                </div>
              )
            )}

            <PrintableTab events={events} getFrets={getEffectiveFrets} />

            {(audioUrl || events.length > 0) && (
              <UnifiedPlayer
                source={playerSource}
                setSource={setPlayerSource}
                isPlaying={isPlaying}
                currentTime={currentTime}
                duration={duration}
                playbackRate={playbackRate}
                onTogglePlay={togglePlay}
                onSeek={seekTo}
                onRateChange={setPlaybackRate}
                isTabPlaying={isTabPlaying}
                tabCurrentTime={tabCurrentTime}
                tabPlaybackRate={tabPlaybackRate}
                onToggleTabAudio={toggleTabAudio}
                onSeekTab={seekTab}
                onTabRateChange={setTabPlaybackRate}
              />
            )}

            {/* start of controls bar */}
            {events.length > 0 && (
              <>
                <TabControls
                  zoom={zoom}
                  setZoom={setZoom}
                  editMode={editMode}
                  setEditMode={setEditMode}
                  hasEdits={Object.keys(editedFrets).length > 0}
                  onResetEdits={() => setEditedFrets({})}
                  onExportPDF={() => exportTabAsPDF(events, getEffectiveFrets)}
                />
                <ShortcutsHint />
              </>
            )}
          </section>
        )}
      </div>
    </main>
  );
}