# Guitar Whisperer

Converts an audio recording of guitar playing into a readable tab, including
chord names and fingering.

## Overview

Given an audio file, the pipeline:

1. Runs Basic Pitch (Spotify's pitch detection model) to get raw note events
2. Passes those through a custom **string-physics simulation** (`StringTracker`)
   that assigns each note to a specific string/fret, using real onset/decay
   analysis to distinguish genuine plucks from harmonic overtones, crosstalk
   bleed, and re-plucked notes that were missed
3. Groups simultaneous notes into chords and identifies the chord names if possible
4. Optimizes fingering across the whole tab to minimize hand movement between notes

## Architecture

- **Frontend**: Next.js, deployed on Vercel
- **Backend**: Flask (Python), deployed on Render
- **Job queue**: RQ (Redis Queue) — transcription jobs run asynchronously on
  a background worker
- **Audio processing**: Basic Pitch inference offloaded to Modal
- **Signal processing**: librosa, scipy

## Acknowledgments

Pitch detection powered by [Basic Pitch](https://github.com/spotify/basic-pitch)
(Spotify).
