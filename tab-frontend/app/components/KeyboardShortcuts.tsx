"use client";

import { useEffect } from "react";

export function KeyboardShortcuts(handlers: {
  onPlayPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.code === "Space") {
        e.preventDefault();
        handlers.onPlayPause();
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        handlers.onNext();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        handlers.onPrev();
      } else if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        handlers.onZoomIn();
      } else if (e.key === "-") {
        e.preventDefault();
        handlers.onZoomOut();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlers]);
}