"use client";

import { useCallback, useState } from "react";
import { ChordEvent } from "./chordTypes";

export function useFretEditor() {
  const [editMode, setEditMode] = useState(false);
  const [editedFrets, setEditedFrets] = useState<Record<number, Record<string, number | null>>>({});
  const [selectedAlt, setSelectedAlt] = useState<Record<number, number>>({});
  const [editingCell, setEditingCell] = useState<{ index: number; string: number } | null>(null);

  const getEffectiveFrets = useCallback(
    (ev: ChordEvent, index: number): Record<string, number | null> => {
      const altIdx = selectedAlt[index] ?? 0;
      const base = ev.alternatives && ev.alternatives[altIdx] ? ev.alternatives[altIdx] : ev.frets;
      const overrides = editedFrets[index];
      return overrides ? { ...base, ...overrides } : base;
    },
    [selectedAlt, editedFrets],
  );

  const cycleAlternative = useCallback((index: number, altCount: number) => {
    setSelectedAlt((prev) => {
      const cur = prev[index] ?? 0;
      return { ...prev, [index]: (cur + 1) % altCount };
    });
  }, []);

  const commitFretEdit = useCallback((index: number, stringNum: number, raw: string) => {
    setEditedFrets((prev) => {
      const trimmed = raw.trim();
      const forThisEvent = { ...(prev[index] || {}) };
      if (trimmed === "" || trimmed === "-" || trimmed.toLowerCase() === "x") {
        forThisEvent[String(stringNum)] = null;
      } else {
        const n = parseInt(trimmed, 10);
        if (!isNaN(n) && n >= 0 && n <= 24) forThisEvent[String(stringNum)] = n;
      }
      return { ...prev, [index]: forThisEvent };
    });
    setEditingCell(null);
  }, []);

  const resetAll = useCallback(() => {
    setEditMode(false);
    setEditedFrets({});
    setSelectedAlt({});
    setEditingCell(null);
  }, []);

  return {
    editMode, setEditMode, editedFrets, setEditedFrets, resetAll,
    selectedAlt, editingCell, setEditingCell,
    getEffectiveFrets, cycleAlternative, commitFretEdit,
  };
}