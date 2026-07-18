import sys
import librosa
import numpy as np
from itertools import product

import logging
logging.getLogger("root").setLevel(logging.ERROR)

STRINGS = {
    6: 'E2', 5: 'A2', 4: 'D3', 3: 'G3', 2: 'B3', 1: 'E4',
}


def build_fretboard(max_fret=12):
    fretboard = {}
    for string_num, open_note in STRINGS.items():
        open_midi = librosa.note_to_midi(open_note)
        for fret in range(max_fret + 1):
            note_midi = open_midi + fret
            note_name = librosa.midi_to_note(note_midi)
            fretboard.setdefault(note_name, []).append((string_num, fret))
    return fretboard


FRETBOARD = build_fretboard()


def compute_onset_envelope(filepath):
    y, sr = librosa.load(filepath, sr=None)
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    times = librosa.frames_to_time(np.arange(len(onset_env)), sr=sr)
    return onset_env, times


def has_onset_near(onset_env, onset_times, t, window=0.03, rel_thresh=1.4, local_span=0.15):
    if onset_env is None:
        return False
    local_mask = (onset_times >= t - local_span) & (onset_times <= t + local_span)
    if not np.any(local_mask):
        return False
    baseline = np.median(onset_env[local_mask])
    if baseline <= 0:
        baseline = 1e-6

    window_mask = (onset_times >= t - window) & (onset_times <= t + window)
    if not np.any(window_mask):
        return False
    peak = np.max(onset_env[window_mask])
    result = peak >= rel_thresh * baseline
    print(f"    onset check t={t:.3f}  peak={peak:.4f}  baseline={baseline:.4f}  ratio={peak/baseline:.2f}  thresh={rel_thresh}  -> {result}")
    return result


def clean_notes(notes, amp_thresh=0.15, max_merge_gap=0.05, min_real_gap=0.02,
                 onset_env=None, onset_times=None, y=None, sr=None):
    keep = [n for n in notes if n["amp"] >= amp_thresh]
    keep.sort(key=lambda n: (n["note"], n["time"]))

    merged = []
    for n in keep:
        if (merged
                and merged[-1]["note"] == n["note"]
                and n["time"] <= merged[-1]["end"] + max_merge_gap):
            gap = n["time"] - merged[-1]["end"]
            is_real_gap = gap >= min_real_gap

            # A genuine re-pluck has its own attack transient -- it doesn't
            # need to be louder than the previous note to be real. A repeat
            # pluck that's the same volume or even quieter (natural decay)
            # is still a distinct note and shouldn't be swallowed.
            is_reattack = False
            if y is not None and sr is not None:
                is_reattack = has_own_pitch_attack(y, sr, n["note"], n["time"])
            elif onset_env is not None:
                is_reattack = has_onset_near(onset_env, onset_times, n["time"])

            if is_real_gap and is_reattack:
                merged.append(dict(n))
                continue
            merged[-1]["end"] = max(merged[-1]["end"], n["end"])
            merged[-1]["amp"] = max(merged[-1]["amp"], n["amp"])
        else:
            merged.append(dict(n))

    for n in merged:
        n["duration"] = round(n["end"] - n["time"], 3)
    merged.sort(key=lambda n: n["time"])
    return merged

def group_into_chords(notes, max_span=0.13, min_overlap_ratio=0.5,
                       onset_env=None, onset_times=None, min_gap_for_attack_check=0.04,
                       y=None, sr=None):
    if not notes:
        return []
    chords = []
    current = [notes[0]]
    group_start = notes[0]["time"]
    group_min_end = notes[0]["end"]
    prev_group = None
    prev_group_start = None
    prev_group_min_end = None

    for n in notes[1:]:
        onset_close = n["time"] - group_start <= max_span
        note_dur = n["end"] - n["time"]
        overlap = min(n["end"], group_min_end) - n["time"]
        overlaps_enough = note_dur > 0 and (overlap / note_dur) >= min_overlap_ratio

        gap = n["time"] - group_start
        has_own_attack = False
        if gap >= min_gap_for_attack_check:
            current_max_amp = max(x["amp"] for x in current)
            likely_masked = n["amp"] < 0.7 * current_max_amp
            if likely_masked and y is not None and sr is not None:
                has_own_attack = has_own_pitch_attack(y, sr, n["note"], n["time"])
            elif onset_env is not None:
                has_own_attack = has_onset_near(onset_env, onset_times, n["time"])

        fits_current = onset_close and overlaps_enough and not has_own_attack

        fits_prev = False
        if prev_group is not None:
            prev_gap_ok = n["time"] - prev_group_start <= max_span
            prev_overlap = min(n["end"], prev_group_min_end) - n["time"]
            prev_overlaps_enough = note_dur > 0 and (prev_overlap / note_dur) >= min_overlap_ratio
            fits_prev = prev_gap_ok and prev_overlaps_enough

        if fits_current and fits_prev:
            current_avg_amp = np.mean([x["amp"] for x in current])
            prev_avg_amp = np.mean([x["amp"] for x in prev_group])
            if abs(n["amp"] - prev_avg_amp) < abs(n["amp"] - current_avg_amp):
                prev_group.append(n)
                prev_group_min_end = min(prev_group_min_end, n["end"])
            else:
                current.append(n)
                group_min_end = min(group_min_end, n["end"])
            continue

        if fits_prev and not fits_current:
            prev_group.append(n)
            prev_group_min_end = min(prev_group_min_end, n["end"])
            continue

        if fits_current:
            current.append(n)
            group_min_end = min(group_min_end, n["end"])
            continue

        prev_group = current
        prev_group_start = group_start
        prev_group_min_end = group_min_end
        chords.append(current)
        current = [n]
        group_start = n["time"]
        group_min_end = n["end"]

    chords.append(current)
    return chords


def filter_chord_bleed(chords, amp_ratio=0.75, y=None, sr=None):
    filtered = []
    previous_notes = []

    for group in chords:
        kept = []
        for n in group:
            midi = librosa.note_to_midi(n["note"])
            bleed = False

            for prev in previous_notes:
                if prev["note"] == n["note"]:
                    continue
                prev_midi = librosa.note_to_midi(prev["note"])
                if prev["end"] < n["time"]:
                    continue

                interval = abs(prev_midi - midi) % 12
                # octaves are plausible acoustic bleed, thirds/fifths are normal chord harmonies and will
                # coexist with a louder note constantly
                if interval != 0:
                    continue

                if prev["amp"] > n["amp"] / amp_ratio:
                    # Before dropping, confirm it doesn't have its own
                    # genuine attack transient (real pluck).
                    if y is not None and sr is not None and has_own_pitch_attack(y, sr, n["note"], n["time"]):
                        continue
                    bleed = True
                    break

            if not bleed:
                kept.append(n)

        filtered.append(kept)
        previous_notes = group

    return filtered


def filter_chord_outliers(chords, rel_thresh=0.35, abs_strong=0.35):
    """
    Remove only extremely weak detections inside a chord.
    Preserve real guitar intervals.
    """
    filtered = []

    for group in chords:
        if len(group) <= 1:
            filtered.append(group)
            continue

        max_amp = max(n["amp"] for n in group)

        kept = []

        for n in group:
            # keep strong notes
            if n["amp"] >= abs_strong:
                kept.append(n)

            # keep notes close to the loudest note
            elif n["amp"] >= rel_thresh * max_amp:
                kept.append(n)

        filtered.append(kept)

    return filtered

HARMONIC_INTERVALS = (12, 19, 24, 28)

def remove_harmonic_artifacts(notes, y=None, sr=None, min_bleed_ratio=0.65,
                                simultaneous_onset_window=0.05,
                                recurring_min_bleed_ratio=0.45):
    cleaned = []
    dropped_pitch_classes = {}

    for n in sorted(notes, key=lambda x: x["time"]):
        midi = librosa.note_to_midi(n["note"])
        is_harmonic = False
        for other in notes:
            if other is n:
                continue
            other_midi = librosa.note_to_midi(other["note"])
            if other_midi >= midi:
                continue
            diff = other_midi - midi if other_midi > midi else midi - other_midi
            if diff not in HARMONIC_INTERVALS:
                continue

            overlaps = n["time"] < other["end"] and other["time"] < n["end"]
            if not overlaps:
                continue
            if n["amp"] >= other["amp"]:
                continue

            onset_gap = abs(n["time"] - other["time"])
            simultaneous_onset = onset_gap < simultaneous_onset_window

            if (not simultaneous_onset and y is not None and sr is not None
                    and has_own_pitch_attack(y, sr, n["note"], n["time"])):
                continue

            amp_ratio = n["amp"] / other["amp"]
            recurring = other["note"] in dropped_pitch_classes.get(n["note"], set())

            threshold = recurring_min_bleed_ratio if recurring else min_bleed_ratio

            if amp_ratio < threshold:
                print(
                    f"DROP harmonic: {n['note']} explained by {other['note']} "
                    f"(amp_ratio={amp_ratio:.2f}, recurring={recurring}, onset_gap={onset_gap:.3f})"
                )
                is_harmonic = True
                dropped_pitch_classes.setdefault(n["note"], set()).add(other["note"])
                break
        if not is_harmonic:
            cleaned.append(n)
    return cleaned


def note_to_freq(note_name):
    midi = librosa.note_to_midi(note_name)
    return librosa.midi_to_hz(midi)


def has_own_pitch_attack(y, sr, note_name, t, window=0.05, rel_thresh=1.6,
                          local_span=0.2, bandwidth_semitones=0.5, min_abs_peak=0.05):
    """
    Check for a fresh attack transient specific to one note's fundamental
    frequency, by bandpass-filtering around that pitch before computing
    onset strength. This can catch a real pluck that's buried in a broadband
    onset envelope because it's quieter than or simultaneous with other
    notes in a strum.
    """
    freq = note_to_freq(note_name)
    low = freq * (2 ** (-bandwidth_semitones / 12))
    high = freq * (2 ** (bandwidth_semitones / 12))

    from scipy.signal import butter, sosfiltfilt
    nyquist = sr / 2
    low_norm = max(low / nyquist, 0.001)
    high_norm = min(high / nyquist, 0.999)
    if low_norm >= high_norm:
        return False
    sos = butter(4, [low_norm, high_norm], btype='band', output='sos')
    y_band = sosfiltfilt(sos, y)

    onset_env = librosa.onset.onset_strength(y=y_band, sr=sr)
    onset_times = librosa.frames_to_time(np.arange(len(onset_env)), sr=sr)

    local_mask = (onset_times >= t - local_span) & (onset_times <= t + local_span)
    if not np.any(local_mask):
        return False
    baseline = np.median(onset_env[local_mask])
    if baseline < 1e-4:
        return False

    window_mask = (onset_times >= t - window) & (onset_times <= t + window)
    if not np.any(window_mask):
        return False
    peak = np.max(onset_env[window_mask])
    ratio = peak / baseline
    result = (ratio >= rel_thresh) and (peak >= min_abs_peak)
    print(f"    band-onset check note={note_name} t={t:.3f} peak={peak:.4f} baseline={baseline:.4f} ratio={ratio:.2f} -> {result}")
    return result

def dedupe_chord(group):
    best_by_note = {}
    for n in group:
        if n["note"] not in best_by_note or n["amp"] > best_by_note[n["note"]]["amp"]:
            best_by_note[n["note"]] = n
    return list(best_by_note.values())


def chords_to_note_names(chords):
    result = []
    for group in chords:
        if not group:          #guard against groups emptied by filtering
            continue
        deduped = dedupe_chord(group)
        result.append({"time": group[0]["time"], "notes": [n["note"] for n in deduped]})
    return result


# Naming the chords for easier reference points for fingers
PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

CHORD_TEMPLATES = {
    (0, 4, 7): 'major',
    (0, 3, 7): 'minor',
    (0, 4, 8): 'aug',
    (0, 3, 6): 'dim',
    (0, 4, 7, 11): 'maj7',
    (0, 3, 7, 10): 'min7',
    (0, 4, 7, 10): '7',
    (0, 3, 6, 10): 'm7b5',
    (0, 5, 7): 'sus4',
    (0, 2, 7): 'sus2',
}

def identify_chord(note_names):
    """note_names: list like ['E4','G#3','B3'] -> 'E major' or None if no match."""
    pitch_classes = set()
    for n in note_names:
        midi = librosa.note_to_midi(n)
        pitch_classes.add(midi % 12)

    best = None
    for root_pc in pitch_classes:
        intervals = tuple(sorted((pc - root_pc) % 12 for pc in pitch_classes))
        if intervals in CHORD_TEMPLATES:
            root_name = PITCH_CLASSES[root_pc]
            quality = CHORD_TEMPLATES[intervals]
            # prefer larger/more specific matches if multiple roots work
            if best is None or len(intervals) > len(best[2]):
                best = (root_name, quality, intervals)

    if best:
        root_name, quality, _ = best
        return f"{root_name} {quality}" if quality != 'major' else f"{root_name} major"
    return None

# better placements for fingers (open strings are preferred, and lower frets are preferred)
COMMON_OPEN_SHAPES = {
    'E major': {6: 0, 5: 2, 4: 2, 3: 1, 2: 0, 1: 0},
    'A major': {5: 0, 4: 2, 3: 2, 2: 2, 1: 0},
    'D major': {4: 0, 3: 2, 2: 3, 1: 2},
    'G major': {6: 3, 5: 2, 4: 0, 3: 0, 2: 0, 1: 3},
    'C major': {5: 3, 4: 2, 3: 0, 2: 1, 1: 0},
    'E minor': {6: 0, 5: 2, 4: 2, 3: 0, 2: 0, 1: 0},
    'A minor': {5: 0, 4: 2, 3: 2, 2: 1, 1: 0},
    'D minor': {4: 0, 3: 2, 2: 3, 1: 1},
}

def score_combo(combo, prev_positions):
    frets = [c[1] for c in combo]
    played_frets = [f for f in frets if f > 0]
    span = (max(played_frets) - min(played_frets)) if played_frets else 0

    if prev_positions:
        prev_frets = [p[1] for p in prev_positions if p[1] > 0]
        if prev_frets:
            anchor = np.mean(prev_frets)
            # penalize distance from the established hand position, harder
            movement = np.mean([abs(f - anchor) for f in frets]) if frets else 0
        else:
            anchor = 0
            movement = np.mean(frets) if frets else 0
    else:
        movement = np.mean(played_frets) if played_frets else 0

    # heavier weight on staying anchored, lighter on span
    return span * 1.0 + movement * 2.5


def find_chord_candidates(note_names, prev_positions, fretboard, chord_name=None, max_candidates=3):
    """Returns up to max_candidates fingerings for the detected notes,
    best-first, as lists of (string_num, fret) tuples."""
    playable = [n for n in note_names if fretboard.get(n)]
    unplayable = [n for n in note_names if not fretboard.get(n)]
    if unplayable:
        print(f"  WARNING: dropping out-of-range note(s): {unplayable}")
    note_names = playable
    if not note_names:
        return None
    
    if len(note_names) > 6:
        print(f"  WARNING: chord has {len(note_names)} distinct notes -- skipping")
        return None

    options_per_note = [fretboard.get(n, []) for n in note_names]
    if any(len(opts) == 0 for opts in options_per_note):
        missing = [n for n, opts in zip(note_names, options_per_note) if not opts]
        print(f"  WARNING: note(s) out of fretboard range: {missing} -- skipping chord")
        return None

    scored = []
    for combo in product(*options_per_note):
        strings_used = [c[0] for c in combo]
        if len(set(strings_used)) != len(strings_used):
            continue
        scored.append((score_combo(combo, prev_positions), list(combo)))
    scored.sort(key=lambda x: x[0])

    seen = set()
    result = []
    for _, combo in scored:
        key = tuple(sorted(combo))
        if key in seen:
            continue
        seen.add(key)
        result.append(combo)
        if len(result) >= max_candidates:
            break

    return result if result else None


def solve_chord_position(note_names, prev_positions, fretboard, chord_name=None):
    """Kept for backward compatibility -- returns just the best candidate."""
    candidates = find_chord_candidates(note_names, prev_positions, fretboard, chord_name, max_candidates=1)
    return candidates[0] if candidates else None

def notes_to_tab(chords):
    columns = []
    events = []
    prev_positions = None
    for chord in chords:
        chord_name = identify_chord(chord["notes"])
        candidates = find_chord_candidates(chord["notes"], prev_positions, FRETBOARD, chord_name)

        if not candidates:
            continue
        positions = candidates[0]
        prev_positions = positions

        col = {s: None for s in range(1, 7)}
        for string_num, fret in positions:
            col[string_num] = fret
        columns.append(col)

        alt_frets = []
        for cand in candidates:
            cand_col = {s: None for s in range(1, 7)}
            for string_num, fret in cand:
                cand_col[string_num] = fret
            alt_frets.append({str(s): cand_col[s] for s in range(1, 7)})

        events.append({
            "time": chord["time"],
            "chord_name": chord_name,
            "frets": {str(s): col[s] for s in range(1, 7)},
            "alternatives": alt_frets,  # alt_frets[0] == frets above
        })

    # ... rest of the function (tab_names, col_widths, output loop) is unchanged
    tab_names = {1: 'e', 2: 'B', 3: 'G', 4: 'D', 5: 'A', 6: 'E'}
    col_widths = []
    for col in columns:
        cells = [str(col[s]) if col[s] is not None else "-" for s in range(1, 7)]
        col_widths.append(max(len(c) for c in cells) if cells else 1)

    output = []
    for s in range(1, 7):
        row_cells = []
        for col, width in zip(columns, col_widths):
            cell = str(col[s]) if col[s] is not None else "-"
            row_cells.append(cell.ljust(width, "-"))
        row = tab_names[s] + "|-" + "-".join(row_cells) + "-|"
        output.append(row)

    return "\n".join(output), events


def audio_to_tab(filepath):
    from basic_pitch.inference import predict

    _, _, note_events = predict(filepath)

    GUITAR_LOW_MIDI = librosa.note_to_midi('E2')  # 40 — nothing below this is physically playable
    GUITAR_HIGH_MIDI = librosa.note_to_midi('E6') # 88 — 24th-fret high E
    notes = []
    for start, end, pitch_midi, amp, _ in note_events:
        rounded = int(round(pitch_midi))
        if rounded < GUITAR_LOW_MIDI or rounded > GUITAR_HIGH_MIDI:
            continue
        note_name = librosa.midi_to_note(int(round(pitch_midi)))
        notes.append({
            "time": round(start, 3), "end": round(end, 3),
            "note": note_name, "duration": round(end - start, 3), "amp": amp,
        })
    notes.sort(key=lambda n: n["time"])
    
    y, sr = librosa.load(filepath, sr=None)
    onset_env, onset_times = compute_onset_envelope(filepath)
    print("before")
    print(notes)
    notes = clean_notes(notes, onset_env=onset_env, onset_times=onset_times, y=y, sr=sr)
    print("after cleaning notes")
    print(notes)
    notes = remove_harmonic_artifacts(notes, y=y, sr=sr)

    chords = group_into_chords(notes, onset_env=onset_env, onset_times=onset_times, y=y, sr=sr)
    chords = filter_chord_bleed(chords, y=y, sr=sr)
    chords = filter_chord_outliers(chords)
    chords = [g for g in chords if g]

    chord_events = chords_to_note_names(chords)
    tab_text, events = notes_to_tab(chord_events)

    # duration of the source audio, used by the frontend to size the scrubber
    # and to know how long the final chord should stay "active"
    duration = float(librosa.get_duration(y=y, sr=sr))

    for i, ev in enumerate(events):
        ev["end_time"] = events[i + 1]["time"] if i + 1 < len(events) else duration

    return {
        "chords": chord_events,
        "tab": tab_text,
        "events": events,
        "duration": duration,
    }


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"Usage: python {sys.argv[0]} <audio_file>")
        sys.exit(1)

    filepath = sys.argv[1]
    result = audio_to_tab(filepath)

    for ev in result["events"][:6]:
        print(f"{ev['time']:.3f}s -> {ev['end_time']:.3f}s  {ev['chord_name']}  {ev['frets']}")
    for c in result["chords"]:
        print(f"{c['time']}s: {c['notes']}")

    print("=== TAB ===")
    print(result["tab"])