"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChordEvent } from "../components/chordTypes";

// Standard tuning: MIDI note number of each open string
const STRING_OPEN_MIDI: Record<number, number> = {
  6: 40, 5: 45, 4: 50, 3: 55, 2: 59, 1: 64,
};

function fretToFrequency(stringNum: number, fret: number) {
  const midi = STRING_OPEN_MIDI[stringNum] + fret;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function SynthPlayer(
  events: ChordEvent[],
  duration: number,
  getEffectiveFrets: (ev: ChordEvent, index: number) => Record<string, number | null>,
) {
  const [isTabPlaying, setIsTabPlaying] = useState(false);
  const [tabActiveIndex, setTabActiveIndex] = useState<number | null>(null);
  const [tabCurrentTime, setTabCurrentTime] = useState(0);
  const [tabPlaybackRate, setTabPlaybackRate] = useState(1);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const tabNodesRef = useRef<OscillatorNode[]>([]);
  const tabAnimRef = useRef<number | null>(null);
  function getAudioContext(): AudioContext {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      audioCtxRef.current = new AudioContextClass();
    }
    return audioCtxRef.current;
  }

  const stopTabAudio = useCallback(() => {
    tabNodesRef.current.forEach((osc) => {
      try { osc.stop(); } catch {}
    });
    tabNodesRef.current = [];
    // don't close/null the context here anymore — just stop the nodes and the loop
    if (tabAnimRef.current !== null) {
      cancelAnimationFrame(tabAnimRef.current);
      tabAnimRef.current = null;
    }
    setIsTabPlaying(false);
    setTabActiveIndex(null);
  }, []);

  const playTabAudio = useCallback(
    (fromTime = 0) => {
      if (events.length === 0) return;
      stopTabAudio();

      const startIndex = Math.max(
        0,
        events.reduce((acc, ev, i) => (ev.time <= fromTime ? i : acc), 0),
      );
      const ctx = getAudioContext();
      if (ctx.state === "suspended") ctx.resume();

      const rate = tabPlaybackRate;
      const startAt = ctx.currentTime + 0.08;
      const anchorTime = events[startIndex].time;
      const schedule: { index: number; start: number; end: number }[] = [];

      events.slice(startIndex).forEach((ev, offset) => {
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
          filter.frequency.setValueAtTime(freq * 12, noteStart);
          filter.frequency.exponentialRampToValueAtTime(freq * 6, noteStart + Math.max(dur, 0.05));
          filter.Q.value = 0.5;

          const gain = ctx.createGain();
          const peak = 0.16;
          gain.gain.setValueAtTime(0.0001, noteStart);
          gain.gain.exponentialRampToValueAtTime(peak, noteStart + 0.008);
          gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + Math.max(dur, 0.05));

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
    },
    [events, duration, tabPlaybackRate, getEffectiveFrets, stopTabAudio],
  );

  const toggleTabAudio = useCallback(() => {
    if (isTabPlaying) stopTabAudio();
    else playTabAudio(tabCurrentTime);
  }, [isTabPlaying, stopTabAudio, playTabAudio, tabCurrentTime]);

  const seekTab = useCallback(
    (t: number) => {
      const wasPlaying = isTabPlaying;
      stopTabAudio();
      setTabCurrentTime(t);
      if (wasPlaying) playTabAudio(t);
    },
    [isTabPlaying, stopTabAudio, playTabAudio],
  );

  useEffect(() => {
    return () => {
      stopTabAudio();
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
    };
  }, [stopTabAudio]);

  return {
    isTabPlaying, tabActiveIndex, tabCurrentTime, tabPlaybackRate,
    setTabPlaybackRate, playTabAudio, stopTabAudio, toggleTabAudio, seekTab,
  };
}