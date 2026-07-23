"""
Audio -> guitar tab transcription.
"""
import os
os.environ["TF_USE_LEGACY_KERAS"] = "1"

import sys
import io
import bisect
import contextlib
import librosa
import numpy as np
from itertools import product
from scipy.signal import butter, sosfiltfilt, find_peaks

import logging
logging.getLogger("root").setLevel(logging.ERROR)

# --------------------------------------------------------------------------
# Guitar transient detector
# --------------------------------------------------------------------------

def detect_guitar_attacks(y, sr, hop_length=256,
                          strength_thresh=1.5,
                          min_gap=0.06):
    """
    Finds physical pluck events from the waveform itself.

    Basic Pitch finds pitches.
    This finds when a string was actually struck.
    """

    onset_env = librosa.onset.onset_strength(
        y=y,
        sr=sr,
        hop_length=hop_length
    )

    peaks, props = find_peaks(
        onset_env,
        distance=int(min_gap * sr / hop_length),
        prominence=np.max(onset_env) * 0.05
    )

    attacks = []

    median = np.median(onset_env)
    median = max(median, 1e-6)

    for p in peaks:
        strength = onset_env[p] / median

        if strength >= strength_thresh:
            attacks.append({
                "time": float(
                    librosa.frames_to_time(
                        p,
                        sr=sr,
                        hop_length=hop_length
                    )
                ),
                "strength": float(strength)
            })

    return attacks

def snap_notes_to_attacks(notes, attacks, max_distance=0.08):
    """
    Pulls Basic Pitch note starts toward real guitar attacks.

    Removes many harmonic ghosts because they usually don't have their own transient.
    """

    snapped = []

    attack_times = [
        a["time"] for a in attacks
    ]

    for n in notes:

        nearest = min(
            attack_times,
            key=lambda x: abs(x - n["time"])
        ) if attack_times else None

        if nearest is not None and abs(nearest - n["time"]) <= max_distance:

            n = dict(n)

            shift = nearest - n["time"]

            n["time"] = round(nearest, 3)

            # move end time with it
            n["end"] = round(
                max(
                    n["time"] + 0.03,
                    n["end"] + shift
                ),
                3
            )

            snapped.append(n)

        else:
            # keep only if it was a very strong event
            if n["amp"] > 0.8:
                snapped.append(n)

    return snapped

def inject_missed_replucks(raw_notes, attacks, onset_detector, min_gap_from_start=0.12,
                            min_gap_from_end=0.08, attack_match_window=0.05,
                            min_split_gap=0.09, debug=False):
    """
    basic_pitch sometimes fails to register a new onset for a same-pitch
    repluck while the previous instance of that pitch is still decaying.
    Tt extends the existing note's `end` instead of emitting
    a second note.

    So a candidate split additionally requires per-pitch corroboration:
    onset_detector.has_attack(note_name, t) must show a genuine transient
    in THIS pitch's own narrow band at that moment, not just broadband
    energy. Broadband attack + per-pitch attack together means real
    repluck; broadband attack alone is someone else's string.
    """
    existing_onsets = sorted(n["time"] for n in raw_notes)
    result = []

    for n in raw_notes:
        interior_attacks = [
            a["time"] for a in attacks
            if n["time"] + min_gap_from_start <= a["time"] <= n["end"] - min_gap_from_end
        ]
        interior_attacks = [
            a for a in interior_attacks
            if not any(abs(a - o) <= attack_match_window for o in existing_onsets if o != n["time"])
        ]
        interior_attacks = [
            a for a in interior_attacks
            if onset_detector.has_attack(n["note"], a)[0]
        ]

        def _bled_from_other_string(a, this_ratio):
            for other in raw_notes:
                if other is n or other["note"] == n["note"]:
                    continue
                if not (other["time"] - attack_match_window <= a < other["end"]):
                    continue
                other_has_attack, other_ratio = onset_detector.has_attack(other["note"], a)
                if other_has_attack and other_ratio > this_ratio:
                    return True, other["note"], other_ratio
            return False, None, None

        confirmed_attacks = []
        for a in interior_attacks:
            _, this_ratio = onset_detector.has_attack(n["note"], a)
            bled, source_note, source_ratio = _bled_from_other_string(a, this_ratio)
            if bled:
                if debug:
                    print(f"  [REPLUCK REJECTED, crosstalk bleed] {n['note']} @ {a:.3f}s: "
                          f"ratio={this_ratio:.3f} weaker than {source_note}'s own "
                          f"attack (ratio={source_ratio:.3f}) at the same instant")
                continue
            confirmed_attacks.append(a)
        interior_attacks = confirmed_attacks

        if not interior_attacks:
            result.append(n)
            continue

        raw_split_points = sorted(round(a, 3) for a in interior_attacks)
        split_points = []
        last_kept = n["time"]
        for sp in raw_split_points:
            if sp - last_kept >= min_split_gap:
                split_points.append(sp)
                last_kept = sp
            elif debug:
                print(f"  [REPLUCK SPLIT SUPPRESSED] {n['note']} @ {sp:.3f}s: only "
                      f"{sp - last_kept:.3f}s after previous split (< {min_split_gap}s) -- "
                      f"treating as noise, not a real repluck")

        segment_start = n["time"]
        for split_t in split_points:
            seg = dict(n)
            seg["time"] = segment_start
            seg["end"] = split_t
            result.append(seg)

            if debug:
                print(f"  [MISSED REPLUCK RECOVERED] {n['note']} @ {segment_start:.3f}s->{split_t:.3f}s: "
                      f"physical attack + per-pitch attack @ {split_t:.3f}s with no matching raw onset")

            segment_start = split_t

        tail = dict(n)
        tail["time"] = segment_start
        result.append(tail)

    result.sort(key=lambda x: x["time"])
    return result


def _quiet_predict(*args, **kwargs):
    """
    basic_pitch.inference.predict prints internal sanity-check lines
    (isfinite/shape/dtype) via plain print() during its multi-window
    inference passes -- these aren't logger calls, so the logging
    suppression above doesn't touch them. Redirect stdout just around
    the call to silence them without hiding anything from this file's
    own prints (--debug, --inspect, etc.), which happen outside this
    function.
    """
    from basic_pitch.inference import predict
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        result = predict(*args, **kwargs)
    return result

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


def note_to_freq(note_name):
    midi = librosa.note_to_midi(note_name)
    return librosa.midi_to_hz(midi)


def merge_duplicate_raw_notes(raw_notes, gap_thresh=0.05):
    """
    Collapse basic_pitch's fragmented duplicate detections of a single
    real pluck into one note, BEFORE the string-physics model ever sees
    them.

    gap_thresh: two same-pitch raw notes starting within this many
    seconds of each other are treated as one fragmented detection, not
    two real re-plucks. 0.05s is comfortably under the fastest realistic
    guitar re-pluck (~0.08-0.1s).
    """
    if not raw_notes:
        return raw_notes

    by_note = {}
    for n in raw_notes:
        by_note.setdefault(n["note"], []).append(n)

    merged = []
    for note_name, group in by_note.items():
        group.sort(key=lambda x: x["time"])
        current = dict(group[0])
        for n in group[1:]:
            if n["time"] - current["end"] <= gap_thresh or n["time"] <= current["end"]:
                current["end"] = max(current["end"], n["end"])
                current["amp"] = max(current["amp"], n["amp"])
            else:
                merged.append(current)
                current = dict(n)
        merged.append(current)

    merged.sort(key=lambda x: x["time"])
    return merged

def group_notes_by_attack(notes, attack_window=0.06):
    """
    Forces notes detected within the same physical pluck window
    to share the same start time.

    Guitar strings in a chord are not perfectly simultaneous.
    A strum can easily spread over 50-100ms.
    """

    if not notes:
        return notes

    groups = []
    current = [notes[0]]
    start = notes[0]["time"]

    for n in notes[1:]:
        if n["time"] - start <= attack_window:
            current.append(n)
        else:
            groups.append(current)
            current = [n]
            start = n["time"]

    groups.append(current)

    result = []

    for group in groups:
        attack_time = min(
            n["time"] for n in group
        )

        for n in group:
            n = dict(n)
            offset = n["time"] - attack_time

            # pull harmonic companions into the same event
            if offset <= attack_window:
                n["time"] = round(attack_time, 3)

            result.append(n)

    return sorted(
        result,
        key=lambda x: x["time"]
    )


# Semitone offsets corresponding to integer frequency ratios (2x, 3x, 4x...)
# above a fundamental: octave, octave+fifth, 2 octaves, etc. Used by
# StringTracker._is_harmonic_ghost below.
HARMONIC_SEMITONES = (12, 19, 24, 28, 31, 36)


# --------------------------------------------------------------------------
# Stage 0: onset + decay-envelope signals, computed once per pitch and
# cached.
# --------------------------------------------------------------------------

class OnsetDetector:
    """
    Computes band-passed onset-strength and RMS-decay envelopes around a
    specific note's fundamental frequency, cached per note name.
    """

    def __init__(self, y, sr, bandwidth_semitones=0.6):
        self.y = y
        self.sr = sr
        self.bandwidth_semitones = bandwidth_semitones
        self._cache = {}

    def _band_signal(self, note_name):
        """Shared band-pass filtering step used by both the onset envelope
        and the RMS decay envelope, so the two stay consistent with each
        other and with has_attack's frequency window."""
        key = ("band", note_name)
        if key in self._cache:
            return self._cache[key]

        freq = note_to_freq(note_name)
        low = freq * (2 ** (-self.bandwidth_semitones / 12))
        high = freq * (2 ** (self.bandwidth_semitones / 12))
        nyquist = self.sr / 2
        low_norm = max(low / nyquist, 0.001)
        high_norm = min(high / nyquist, 0.999)

        if low_norm >= high_norm:
            self._cache[key] = None
            return None

        sos = butter(4, [low_norm, high_norm], btype='band', output='sos')
        y_band = sosfiltfilt(sos, self.y)
        self._cache[key] = y_band
        return y_band

    def _envelope(self, note_name):
        if note_name in self._cache:
            return self._cache[note_name]

        y_band = self._band_signal(note_name)
        if y_band is None:
            self._cache[note_name] = (None, None)
            return None, None

        onset_env = librosa.onset.onset_strength(y=y_band, sr=self.sr)
        onset_times = librosa.frames_to_time(np.arange(len(onset_env)), sr=self.sr)
        self._cache[note_name] = (onset_env, onset_times)
        return onset_env, onset_times

    def _rms_envelope(self, note_name, hop_length=512):
        """
        Amplitude (RMS) envelope in the same band used by has_attack, on a
        fixed frame grid (hop_length=512, librosa's onset_strength default)
        so two pitches' envelopes can be compared index-for-index without
        resampling.
        """
        key = ("rms", note_name)
        if key in self._cache:
            return self._cache[key]

        y_band = self._band_signal(note_name)
        if y_band is None:
            self._cache[key] = (None, None)
            return None, None

        rms = librosa.feature.rms(y=y_band, frame_length=2048, hop_length=hop_length)[0]
        times = librosa.frames_to_time(np.arange(len(rms)), sr=self.sr, hop_length=hop_length)
        self._cache[key] = (rms, times)
        return rms, times

    def has_attack(self, note_name, t, window=0.05, rel_thresh=1.6,
                   local_span=0.2, min_abs_peak=0.05, baseline_gap=0.06):
        """
        True if there's a genuine fresh attack for this pitch near time t,
        judged against a narrow local baseline (+/- local_span around t,
        excluding baseline_gap immediately next to t).

        CONFIRMED LIMITATION: this cannot distinguish a real note from a
        harmonic ghost of a note sounding at the same instant -- both
        produce a genuine transient in this pitch's band. _is_harmonic_ghost
        falls back to decay_ratio_drift specifically for cases this method
        cannot resolve.
        """
        onset_env, onset_times = self._envelope(note_name)
        if onset_env is None:
            return False, 0.0

        window_mask = (onset_times >= t - window) & (onset_times <= t + window)
        if not np.any(window_mask):
            return False, 0.0
        peak = np.max(onset_env[window_mask])

        baseline_mask = (
            ((onset_times >= t - local_span) & (onset_times <= t - baseline_gap))
            | ((onset_times >= t + baseline_gap) & (onset_times <= t + local_span))
        )
        if np.any(baseline_mask):
            baseline = np.median(onset_env[baseline_mask])
        else:
            baseline = 1e-4
        baseline = max(baseline, 1e-4)

        ratio = peak / baseline
        result = ratio >= rel_thresh or peak >= (min_abs_peak * 3)
        result = result and peak >= min_abs_peak
        return result, ratio

    # def decay_correlation(self, note_name, other_note, t, span=0.4):
    #     """
    #     Correlation between note_name's and other_note's band-passed RMS
    #     envelopes over the span following t. Returns None if either envelope is too
    #     flat or too short a window to judge.
    #     """
    #     env_a, times_a = self._rms_envelope(note_name)
    #     env_b, times_b = self._rms_envelope(other_note)
    #     if env_a is None or env_b is None:
    #         return None

    #     mask = (times_a >= t) & (times_a <= t + span)
    #     if np.sum(mask) < 4:
    #         return None

    #     a, b = env_a[mask], env_b[mask]
    #     if np.std(a) < 1e-8 or np.std(b) < 1e-8:
    #         return None
    #     return float(np.corrcoef(a, b)[0, 1])

    def decay_ratio_drift(self, note_name, other_note, t, span=0.4, eps=1e-8):
        """
        A harmonic overtone's amplitude is a fixed fraction of its
        fundamental's, so 20*log10(env_a/env_b) should stay roughly flat
        over time even as both envelopes decay. An independent note has
        its own decay rate unrelated to the other pitch, so that dB ratio
        should drift.

        CALLERS MUST clamp span to the shorter candidate's actual
        remaining duration -- a fixed span can sample one pitch's post-note
        noise floor against the other's still-real decay and inflate drift
        past even independent-pair values (confirmed on riff.wav).

        Returns the std deviation (in dB) of the ratio after linear
        detrending, or None if either envelope is too flat/short to judge.
        Lower = more stable ratio = more harmonic-like, by hypothesis.
        """
        env_a, times_a = self._rms_envelope(note_name)
        env_b, times_b = self._rms_envelope(other_note)
        if env_a is None or env_b is None:
            return None

        mask = (times_a >= t) & (times_a <= t + span)
        if np.sum(mask) < 4:
            return None

        a, b = env_a[mask], env_b[mask]
        if np.min(a) < eps or np.min(b) < eps:
            return None

        ratio_db = 20 * np.log10(a / b)
        x = np.arange(len(ratio_db))
        slope, intercept = np.polyfit(x, ratio_db, 1)
        detrended = ratio_db - (slope * x + intercept)
        return float(np.std(detrended))

    # def _broadband_envelope(self):
    #     """
    #     Onset-strength envelope of the FULL, unfiltered signal -- no
    #     per-pitch band-pass. Computed once, cached. CONFIRMED unable to
    #     separate real reattacks from beating between already-ringing
    #     notes - kept for reference/experimentation.
    #     """
    #     key = "broadband_onset"
    #     if key in self._cache:
    #         return self._cache[key]
    #     onset_env = librosa.onset.onset_strength(y=self.y, sr=self.sr)
    #     onset_times = librosa.frames_to_time(np.arange(len(onset_env)), sr=self.sr)
    #     self._cache[key] = (onset_env, onset_times)
    #     return onset_env, onset_times

    # def broadband_has_attack(self, t, window=0.05, rel_thresh=1.5,
    #                           local_span=0.2, min_abs_peak=0.05, baseline_gap=0.06):
    #     """
    #     Same shape check as has_attack, but on the full, unfiltered
    #     signal's onset envelope. See _broadband_envelope docstring --
    #     this alone is CONFIRMED insufficient to separate real reattacks
    #     from beating; kept for reference/experimentation only.
    #     """
    #     onset_env, onset_times = self._broadband_envelope()
    #     if onset_env is None:
    #         return False, 0.0

    #     window_mask = (onset_times >= t - window) & (onset_times <= t + window)
    #     if not np.any(window_mask):
    #         return False, 0.0
    #     peak = np.max(onset_env[window_mask])

    #     baseline_mask = (
    #         ((onset_times >= t - local_span) & (onset_times <= t - baseline_gap))
    #         | ((onset_times >= t + baseline_gap) & (onset_times <= t + local_span))
    #     )
    #     if np.any(baseline_mask):
    #         baseline = np.median(onset_env[baseline_mask])
    #     else:
    #         baseline = 1e-4
    #     baseline = max(baseline, 1e-4)

    #     ratio = peak / baseline
    #     result = ratio >= rel_thresh or peak >= (min_abs_peak * 3)
    #     result = result and peak >= min_abs_peak
    #     return result, ratio

    # def broadband_attack_width(self, t, window=0.05, local_span=0.2, baseline_gap=0.06,
    #                             half_max_frac=0.5):
    #     """
    #     Full-width-at-half-max (seconds) of the broadband onset peak
    #     nearest t. CONFIRMED unable to separate real reattacks from
    #     beating. Kept for reference/experimentation only.
    #     """
    #     onset_env, onset_times = self._broadband_envelope()
    #     if onset_env is None:
    #         return None

    #     window_mask = (onset_times >= t - window) & (onset_times <= t + window)
    #     if not np.any(window_mask):
    #         return None
    #     idx_in_window = np.where(window_mask)[0]
    #     peak_idx = idx_in_window[np.argmax(onset_env[idx_in_window])]
    #     peak_val = onset_env[peak_idx]

    #     baseline_mask = (
    #         ((onset_times >= t - local_span) & (onset_times <= t - baseline_gap))
    #         | ((onset_times >= t + baseline_gap) & (onset_times <= t + local_span))
    #     )
    #     baseline = np.median(onset_env[baseline_mask]) if np.any(baseline_mask) else 1e-4
    #     baseline = max(baseline, 1e-4)

    #     half_max = baseline + half_max_frac * (peak_val - baseline)

    #     left = peak_idx
    #     while left > 0 and onset_env[left] > half_max:
    #         left -= 1
    #     right = peak_idx
    #     while right < len(onset_env) - 1 and onset_env[right] > half_max:
    #         right += 1

    #     if left == peak_idx and right == peak_idx:
    #         return 0.0
    #     return float(onset_times[right] - onset_times[left])


# --------------------------------------------------------------------------
# Stage 1 + 2: physical string-state simulation.
# --------------------------------------------------------------------------

class StringTracker:
    def __init__(self, fretboard, onset_detector, prefer_open=True,
                 min_repluck_gap=0.09, debug=False):
        self.fretboard = fretboard
        self.onset = onset_detector
        self.prefer_open = prefer_open
        self.min_repluck_gap = min_repluck_gap
        self.debug = debug
        self.state = {s: None for s in STRINGS}
        # tracks the last fretted (non-open) position played, so _choose can
        # prefer staying near it instead of always jumping back to the
        # lowest open string available -- see _choose for the reasoning.
        self.last_fret = None

    def _candidate_strings(self, note_name, t):
        options = self.fretboard.get(note_name, [])
        free, same_note_busy = [], []
        for string_num, fret in options:
            occupant = self.state[string_num]
            if occupant is None or occupant["end"] <= t:
                free.append((string_num, fret))
            elif occupant["note"] == note_name:
                same_note_busy.append((string_num, fret))
        return free, same_note_busy

    def _choose(self, options, open_bonus=1.5):
        """
        Scores each candidate by its fret distance from self.last_fret
        (the last *fretted*, i.e. non-open, position played), so the hand
        tends to stay in one area across a run of notes rather than
        resetting every time. Open strings get a flat discount (open_bonus)
        since they cost nothing to play regardless of hand position, but
        aren't an unconditional first choice. Falls back to
        prefer_open/lowest-fret behavior when there's no prior position yet.
        """
        if not options:
            return None

        def cost(opt):
            _, fret = opt
            if self.last_fret is not None:
                base = abs(fret - self.last_fret)
            elif self.prefer_open:
                base = fret
            else:
                base = fret if fret > 0 else 999
            return base - open_bonus if fret == 0 else base

        return sorted(options, key=cost)[0]

    @staticmethod
    def _is_solo_window(note_name, t0, t1, all_notes, margin=0.05):
        for other in all_notes:
            if other["note"] == note_name:
                continue
            if other["time"] < t1 + margin and other["end"] > t0 - margin:
                return False
        return True

    def _find_tail_reattack(self, note_name, t0, t1, corroboration_notes, all_notes,
                             dip_frac=0.5,
                             min_second_peak_frac=0.25, min_prominence_frac=0.18,
                             min_peak_gap=0.05, raw_note_corroborate_window=0.15,
                             solo_dip_frac_mult=0.6, solo_second_peak_frac_mult=1.5,
                             solo_min_frac_of_note_peak=0.5, dual_strong_peaks_thresh=0.7,
                             dual_strong_dip_frac=0.65, chord_strum_margin=0.13):
        rms, times = self.onset._rms_envelope(note_name)
        if rms is None:
            if self.debug:
                print(f"    [reattack: no rms envelope] {note_name} @ {t0:.3f}s->{t1:.3f}s")
            return None

        mask = (times >= t0) & (times <= t1)
        if np.sum(mask) < 8:
            if self.debug:
                print(f"    [reattack: too few frames] {note_name} @ {t0:.3f}s->{t1:.3f}s "
                      f"({np.sum(mask)} frames)")
            return None
        seg_t, seg_r = times[mask], rms[mask]
        if len(seg_r) < 5:
            if self.debug:
                print(f"    [reattack: too few frames] {note_name} @ {t0:.3f}s->{t1:.3f}s "
                      f"({len(seg_r)} frames after mask)")
            return None

        overall_peak = np.max(seg_r)
        if overall_peak <= 1e-6:
            if self.debug:
                print(f"    [reattack: flat envelope] {note_name} @ {t0:.3f}s->{t1:.3f}s "
                      f"overall_peak={overall_peak:.6f}")
            return None

        if len(seg_t) > 1:
            frame_dt = np.median(np.diff(seg_t))
            distance = max(int(round(min_peak_gap / frame_dt)), 1) if frame_dt > 0 else 1
        else:
            distance = 1

        peaks, _ = find_peaks(
            seg_r,
            distance=distance,
            prominence=min_prominence_frac * overall_peak,
        )
        if len(peaks) < 2:
            if self.debug:
                peak_vals = [f"{seg_r[p]:.4f}@{seg_t[p]:.3f}s" for p in peaks]
                print(f"    [reattack: <2 peaks found] {note_name} @ {t0:.3f}s->{t1:.3f}s "
                      f"overall_peak={overall_peak:.4f} prominence_floor={min_prominence_frac * overall_peak:.4f} "
                      f"peaks_found={peak_vals}")
            return None

        other_onsets = sorted(
            n["time"] for n in corroboration_notes
            if n["note"] != note_name and abs(n["time"] - t0) > chord_strum_margin
        )

        is_solo = self._is_solo_window(note_name, t0, t1, all_notes)

        for i in range(len(peaks) - 1):
            p0, p1 = peaks[i], peaks[i + 1]
            peak0_v, peak1_v = seg_r[p0], seg_r[p1]
            smaller_peak = min(peak0_v, peak1_v)

            between = seg_r[p0:p1 + 1]
            trough_local_idx = int(np.argmin(between))
            trough_v = between[trough_local_idx]
            trough_t = seg_t[p0 + trough_local_idx]

            dual_strong_peaks = (peak0_v >= dual_strong_peaks_thresh * overall_peak
                                  and peak1_v >= dual_strong_peaks_thresh * overall_peak)
            dip_frac_effective = dual_strong_dip_frac if dual_strong_peaks else dip_frac

            shape_ok = (trough_v <= dip_frac_effective * smaller_peak
                        and peak1_v >= min_second_peak_frac * peak0_v)
            if not shape_ok:
                if self.debug:
                    print(f"    [reattack candidate REJECTED, amplitude shape] {note_name} "
                          f"trough@{trough_t:.3f}s trough_v={trough_v:.4f} "
                          f"peak0={peak0_v:.4f} peak1={peak1_v:.4f} "
                          f"peak0/overall={peak0_v/overall_peak:.3f} peak1/overall={peak1_v/overall_peak:.3f}")
                continue

            idx = bisect.bisect_left(other_onsets, trough_t)
            nearby = []
            if idx < len(other_onsets):
                nearby.append(other_onsets[idx])
            if idx > 0:
                nearby.append(other_onsets[idx - 1])
            corroborated = any(abs(o - trough_t) <= raw_note_corroborate_window for o in nearby)

            accepted_reason = None
            if corroborated:
                accepted_reason = "other-pitch corroboration"
            elif dual_strong_peaks and is_solo:
                accepted_reason = "dual strong peaks"
            elif is_solo:
                strict_dip_ok = trough_v <= (dip_frac * solo_dip_frac_mult) * smaller_peak
                strict_recover_ok = peak1_v >= (min_second_peak_frac * solo_second_peak_frac_mult) * peak0_v
                strong_enough = (peak0_v >= solo_min_frac_of_note_peak * overall_peak
                                  and peak1_v >= solo_min_frac_of_note_peak * overall_peak)
                if strict_dip_ok and strict_recover_ok and strong_enough:
                    accepted_reason = "strict solo shape"

            if self.debug:
                print(f"    [reattack candidate] {note_name} trough@{trough_t:.3f}s "
                      f"trough_v={trough_v:.4f} peak0={peak0_v:.4f} peak1={peak1_v:.4f} "
                      f"peak0/overall={peak0_v/overall_peak:.3f} peak1/overall={peak1_v/overall_peak:.3f} "
                      f"raw_note_corroborated={corroborated} is_solo={is_solo} accepted_via={accepted_reason}")

            if accepted_reason is None:
                continue

            return round(float(trough_t), 3)

        return None

    def _is_harmonic_ghost(self, note_name, amp, t, all_notes, end=None, sync_window=0.05,
                            lookback=1.5, sync_amp_ratio_thresh=0.8,
                            ringing_amp_ratio_thresh=0.75, ringing_rel_thresh=2.5,
                            ratio_drift_thresh=2.1, decay_corr_span=0.4,
                            min_drift_span=0.08, occupants=None,
                            chord_ratio_drift_thresh=0.9, chord_min_other_concurrent=2,
                            chord_concurrent_window=0.15,
                            recurring_ratio_drift_thresh=0.3, recurring_min_count=2,
                            no_drift_amp_ratio_thresh=0.5):
        n_midi = librosa.note_to_midi(note_name)
        if occupants is None:
            occupants = self.state.values()

        recurrence = sum(1 for o in all_notes if o["note"] == note_name and o["time"] != t)
        is_recurring = recurrence >= recurring_min_count

        for other in all_notes:
            if other["note"] == note_name or abs(other["time"] - t) > sync_window:
                continue
            interval = n_midi - librosa.note_to_midi(other["note"])
            if interval in HARMONIC_SEMITONES and amp <= other["amp"] * sync_amp_ratio_thresh:
                has_attack, ratio = self.onset.has_attack(note_name, t)
                if not has_attack:
                    return True
                candidate_remaining = (end - t) if end is not None else decay_corr_span
                other_remaining = other["end"] - t
                span = max(min(candidate_remaining, other_remaining, decay_corr_span), 0.0)
                drift = (self.onset.decay_ratio_drift(note_name, other["note"], t, span=span)
                         if span >= min_drift_span else None)

                other_concurrent = {
                    o["note"] for o in all_notes
                    if o["note"] not in (note_name, other["note"])
                    and abs(o["time"] - t) <= chord_concurrent_window
                }
                is_full_chord = len(other_concurrent) >= chord_min_other_concurrent
                effective_drift_thresh = chord_ratio_drift_thresh if is_full_chord else ratio_drift_thresh
                if is_recurring:
                    effective_drift_thresh = min(effective_drift_thresh, recurring_ratio_drift_thresh)

                if drift is not None:
                    ghost_call = drift <= effective_drift_thresh
                else:
                    # Can't measure drift (span too short/quiet -- common in
                    # the first ~0.1-0.2s of a track, or for a fast-decaying
                    # note). Falling through to "not a ghost" here throws
                    # away the interval+amplitude evidence that already got
                    # us into this branch. Fall back to a tighter
                    # amplitude-only check instead of defaulting to real.
                    ghost_call = amp <= other["amp"] * no_drift_amp_ratio_thresh

                if self.debug:
                    drift_str = f"{drift:.3f}" if drift is not None else "None"
                    print(f"  [harmonic-ghost check, simultaneous] {note_name} @ {t:.3f}s "
                          f"amp={amp:.4f} vs {other['note']}@{other['amp']:.4f} "
                          f"attack_ratio={ratio:.3f} ratio_drift={drift_str} span={span:.3f} "
                          f"chord_size={len(other_concurrent) + 2} recurrence={recurrence} "
                          f"is_recurring={is_recurring} thresh={effective_drift_thresh} "
                          f"ghost_call={ghost_call}")
                if ghost_call:
                    return True

        for occupant in occupants:
            if occupant is None or t < occupant["start"] or t - occupant["start"] > lookback:
                continue
            interval = n_midi - librosa.note_to_midi(occupant["note"])
            if interval in HARMONIC_SEMITONES and amp <= occupant["amp"] * ringing_amp_ratio_thresh:
                has_attack, ratio = self.onset.has_attack(note_name, t, rel_thresh=ringing_rel_thresh)
                if not has_attack:
                    return True
                candidate_remaining = (end - t) if end is not None else decay_corr_span
                occupant_remaining = occupant["end"] - t
                span = max(min(candidate_remaining, occupant_remaining, decay_corr_span), 0.0)
                drift = (self.onset.decay_ratio_drift(note_name, occupant["note"], t, span=span)
                         if span >= min_drift_span else None)
                effective_ringing_thresh = (
                    recurring_ratio_drift_thresh if is_recurring else ratio_drift_thresh
                )
                if drift is not None:
                    ghost_call = drift <= effective_ringing_thresh
                else:
                    ghost_call = amp <= occupant["amp"] * no_drift_amp_ratio_thresh

                if self.debug:
                    drift_str = f"{drift:.3f}" if drift is not None else "None"
                    print(f"  [harmonic-ghost check, ringing] {note_name} @ {t:.3f}s "
                          f"amp={amp:.4f} vs ringing {occupant['note']}@{occupant['amp']:.4f} "
                          f"attack_ratio={ratio:.3f} ratio_drift={drift_str} span={span:.3f} "
                          f"recurrence={recurrence} is_recurring={is_recurring} thresh={effective_ringing_thresh} "
                          f"ghost_call={ghost_call}")
                if ghost_call:
                    return True
        return False

    @staticmethod
    def _synthetic_occupants(all_notes, t, exclude_note=None):
        return [
            {"note": n["note"], "amp": n["amp"], "start": n["time"], "end": n["end"]}
            for n in all_notes
            if n["note"] != exclude_note and n["time"] <= t < n["end"]
        ]

    def _is_crosstalk_bleed(self, note_name, amp, t, all_notes, window=0.05, amp_ratio_thresh=0.5):
        for other in all_notes:
            if other["note"] == note_name:
                continue
            if abs(other["time"] - t) > window:
                continue
            if other["amp"] > amp / amp_ratio_thresh:
                return True
        return False

    def process(self, notes, max_splits=3):
        all_notes = notes

        ghost_free_notes = [
            n for n in notes
            if not self._is_harmonic_ghost(
                n["note"], n["amp"], n["time"], all_notes, end=n["end"],
                occupants=self._synthetic_occupants(all_notes, n["time"], exclude_note=n["note"]),
            )
        ]

        queue = sorted(notes, key=lambda x: x["time"])
        accepted = []
        i = 0
        while i < len(queue):
            n = queue[i]
            i += 1
            t, note_name = n["time"], n["note"]
            split_depth = n.get("_split_depth", 0)

            if self._is_harmonic_ghost(note_name, n["amp"], t, all_notes, end=n["end"]):
                reattack_t = None
                if split_depth < max_splits:
                    reattack_t = self._find_tail_reattack(note_name, t, n["end"], ghost_free_notes, all_notes)
                if reattack_t is not None and reattack_t < n["end"]:
                    if self.debug:
                        print(f"  [GHOST TAIL RE-ATTACK] {note_name}: dropping ghost onset "
                              f"@ {t:.3f}s but keeping tail from {reattack_t:.3f}s "
                              f"(depth={split_depth + 1})")
                    tail = dict(n)
                    tail["time"] = reattack_t
                    tail["_split_depth"] = split_depth + 1
                    bisect.insort(queue, tail, key=lambda x: x["time"])
                else:
                    if self.debug:
                        print(f"  [DROPPED as harmonic ghost] {note_name} @ {t:.3f}s amp={n['amp']:.4f}")
                continue

            free, same_note_busy = self._candidate_strings(note_name, t)

            if free:
                string_num, fret = self._choose(free)
            elif same_note_busy:
                string_num, fret = self._choose(same_note_busy)
                occ = self.state[string_num]

                if t - occ["start"] < self.min_repluck_gap:
                    if self.debug:
                        print(f"  [DROPPED, too-fast repluck] {note_name} @ {t:.3f}s "
                              f"(gap={t - occ['start']:.3f}s < {self.min_repluck_gap})")
                    occ["end"] = max(occ["end"], n["end"])
                    occ["amp"] = max(occ["amp"], n["amp"])
                    continue

                has_attack, ratio = self.onset.has_attack(note_name, t)
                is_bleed = has_attack and self._is_crosstalk_bleed(note_name, n["amp"], t, all_notes)
                if not has_attack or is_bleed:
                    if self.debug:
                        reason = "no fresh attack" if not has_attack else "crosstalk bleed"
                        print(f"  [DROPPED, {reason}] {note_name} @ {t:.3f}s "
                              f"amp={n['amp']:.4f} attack_ratio={ratio:.3f}")
                    occ["end"] = max(occ["end"], n["end"])
                    occ["amp"] = max(occ["amp"], n["amp"])
                    continue
            else:
                has_attack, ratio = self.onset.has_attack(note_name, t)
                options = self.fretboard.get(note_name, [])
                if not has_attack:
                    if self.debug:
                        print(f"  [DROPPED, no free string + no attack] {note_name} @ {t:.3f}s "
                              f"amp={n['amp']:.4f} attack_ratio={ratio:.3f}")
                    continue
                if not options:
                    continue

                string_num, fret = min(
                    options,
                    key=lambda sf: self.state[sf[0]]["start"] if self.state[sf[0]] else -1,
                )
                stolen = self.state[string_num]
                if stolen is not None and stolen["end"] > t:
                    if self.debug:
                        print(f"  [STOLE STRING {string_num}] {note_name} @ {t:.3f}s truncates "
                              f"{stolen['note']} (was ->{stolen['end']:.3f}s) to ->{t:.3f}s")
                    for prior in reversed(accepted):
                        if (prior["string"] == string_num
                                and prior["note"] == stolen["note"]
                                and prior["time"] == stolen["start"]):
                            prior["end"] = t
                            break
            note_end = n["end"]
            if split_depth < max_splits:
                reattack_t = self._find_tail_reattack(note_name, t, note_end, ghost_free_notes, all_notes)
                if reattack_t is not None and reattack_t < note_end:
                    if self.debug:
                        print(f"  [TAIL SPLIT] {note_name} @ {t:.3f}s->{note_end:.3f}s: "
                              f"treating as two plucks, splitting at {reattack_t:.3f}s "
                              f"(depth={split_depth + 1})")
                    tail = dict(n)
                    tail["time"] = reattack_t
                    tail["_split_depth"] = split_depth + 1
                    bisect.insort(queue, tail, key=lambda x: x["time"])
                    note_end = reattack_t

            self.state[string_num] = {
                "note": note_name, "start": t, "end": note_end,
                "amp": n["amp"], "fret": fret,
            }
            if fret > 0:
                self.last_fret = fret
            accepted.append({
                "time": t, "end": note_end, "note": note_name,
                "amp": n["amp"], "string": string_num, "fret": fret,
            })

        for note in accepted:
            note["duration"] = round(note["end"] - note["time"], 3)
        accepted.sort(key=lambda x: x["time"])
        return accepted


# --------------------------------------------------------------------------
# Stage 3: chord grouping.
# --------------------------------------------------------------------------

def group_into_chords(notes, max_span=0.13):
    if not notes:
        return []
    chords = []
    current = [notes[0]]
    group_start = notes[0]["time"]

    for n in notes[1:]:
        if n["time"] - group_start <= max_span:
            current.append(n)
        else:
            chords.append(current)
            current = [n]
            group_start = n["time"]
    chords.append(current)
    return chords


def dedupe_chord(group):
    best_by_string = {}
    for n in group:
        s = n["string"]
        if s not in best_by_string or n["amp"] > best_by_string[s]["amp"]:
            best_by_string[s] = n
    return list(best_by_string.values())


def chords_to_events(chords, early_window=0.13):
    result = []
    for group in chords:
        if not group:
            continue

        group_start = min(n["time"] for n in group)
        early = [
            n for n in group
            if n["time"] - group_start <= early_window
        ]

        if len(early) >= 2:
            group = early

        deduped = dedupe_chord(group)

        result.append({
            "time": group[0]["time"],
            "notes": [n["note"] for n in deduped],
            "positions": [(n["string"], n["fret"]) for n in deduped],
        })

    return result


# --------------------------------------------------------------------------
# Chord naming
# --------------------------------------------------------------------------

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
            if best is None or len(intervals) > len(best[2]):
                best = (root_name, quality, intervals)

    if best:
        root_name, quality, _ = best
        return f"{root_name} {quality}" if quality != 'major' else f"{root_name} major"
    return None


# --------------------------------------------------------------------------
# Stage 4: fingering refinement.
# --------------------------------------------------------------------------

def score_combo(combo, prev_positions):
    frets = [c[1] for c in combo]
    played_frets = [f for f in frets if f > 0]
    span = (max(played_frets) - min(played_frets)) if played_frets else 0

    if prev_positions:
        prev_frets = [p[1] for p in prev_positions if p[1] > 0]
        anchor = np.mean(prev_frets) if prev_frets else 0
        movement = np.mean([abs(f - anchor) for f in frets]) if frets else 0
    else:
        movement = np.mean(played_frets) if played_frets else 0

    return span * 1.0 + movement * 2.5


def refine_positions(chord_events, fretboard, max_candidates=3):
    prev_positions = None
    refined = []

    for chord in chord_events:
        note_names = chord["notes"]
        options_per_note = [fretboard.get(n, []) for n in note_names]
        if any(len(opts) == 0 for opts in options_per_note):
            missing = [n for n, opts in zip(note_names, options_per_note) if not opts]
            print(f"  WARNING: note(s) out of fretboard range: {missing} -- skipping chord")
            continue

        scored = []
        for combo in product(*options_per_note):
            strings_used = [c[0] for c in combo]
            if len(set(strings_used)) != len(strings_used):
                continue
            scored.append((score_combo(combo, prev_positions), list(combo)))
        scored.sort(key=lambda x: x[0])

        seen = set()
        candidates = []
        for _, combo in scored:
            key = tuple(sorted(combo))
            if key in seen:
                continue
            seen.add(key)
            candidates.append(combo)
            if len(candidates) >= max_candidates:
                break

        if not candidates:
            candidates = [chord["positions"]]

        positions = candidates[0]
        prev_positions = positions
        refined.append({
            "time": chord["time"],
            "notes": note_names,
            "positions": positions,
            "alternatives": candidates,
        })

    return refined


def notes_to_tab(refined_chords):
    columns = []
    events = []

    for chord in refined_chords:
        chord_name = identify_chord(chord["notes"])
        col = {s: None for s in range(1, 7)}
        for string_num, fret in chord["positions"]:
            col[string_num] = fret
        columns.append(col)

        alt_frets = []
        for cand in chord["alternatives"]:
            cand_col = {s: None for s in range(1, 7)}
            for string_num, fret in cand:
                cand_col[string_num] = fret
            alt_frets.append({str(s): cand_col[s] for s in range(1, 7)})

        events.append({
            "time": chord["time"],
            "chord_name": chord_name,
            "frets": {str(s): col[s] for s in range(1, 7)},
            "alternatives": alt_frets,
        })

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


# --------------------------------------------------------------------------
# Diagnostic: raw pre-threshold activation inspector.
# --------------------------------------------------------------------------

def inspect_raw_activations(filepath, t_start, t_end, top_k=8):
    model_output, _, _ = _quiet_predict(filepath, onset_threshold=0.0, frame_threshold=0.0)

    frame_posterior = model_output.get("note")
    if frame_posterior is None:
        print("Could not find 'note' key in model_output. Available keys/shapes:")
        for k, v in model_output.items():
            print(f"  {k}: shape={getattr(v, 'shape', None)}")
        return

    n_frames, n_pitches = frame_posterior.shape
    real_duration = librosa.get_duration(path=filepath)
    hop_seconds = real_duration / n_frames
    frame_lo = max(0, int(t_start / hop_seconds))
    frame_hi = min(n_frames, int(t_end / hop_seconds))

    if frame_lo >= frame_hi:
        print(f"Requested window {t_start}s-{t_end}s is out of range (track has {n_frames} frames, "
              f"~{real_duration:.2f}s).")
        return

    window = frame_posterior[frame_lo:frame_hi]
    max_per_pitch = window.max(axis=0)
    top_pitches = np.argsort(max_per_pitch)[::-1][:top_k]

    print(f"\nTop {top_k} activated pitch bins between {t_start}s and {t_end}s "
          f"(frames {frame_lo}-{frame_hi} of {n_frames}):")
    for p in top_pitches:
        midi = p + 21
        try:
            note_name = librosa.midi_to_note(midi)
        except Exception:
            note_name = f"midi{midi}"
        print(f"  {note_name} (midi {midi}): max activation = {max_per_pitch[p]:.4f}")


# --------------------------------------------------------------------------
# Top-level pipeline
# --------------------------------------------------------------------------

def audio_to_tab(filepath, debug=False, onset_threshold=0.5, frame_threshold=0.3):
    _, _, note_events = _quiet_predict(
        filepath,
        onset_threshold=onset_threshold,
        frame_threshold=frame_threshold,
    )

    GUITAR_LOW_MIDI = librosa.note_to_midi('E2')
    GUITAR_HIGH_MIDI = librosa.note_to_midi('E6')
    raw_notes = []
    for start, end, pitch_midi, amp, _ in note_events:
        rounded = int(round(pitch_midi))
        if rounded < GUITAR_LOW_MIDI or rounded > GUITAR_HIGH_MIDI:
            continue
        note_name = librosa.midi_to_note(rounded)
        raw_notes.append({
            "time": round(start, 3), "end": round(end, 3),
            "note": note_name, "amp": amp,
        })
    raw_notes.sort(key=lambda n: n["time"])

    raw_notes = merge_duplicate_raw_notes(raw_notes)
    raw_notes = group_notes_by_attack(raw_notes)
    if debug:
        for n in raw_notes:
            print(f"  RAW: {n['note']} @ {n['time']:.3f}s->{n['end']:.3f}s amp={n['amp']:.4f}")

    y, sr = librosa.load(filepath, sr=None)

    attacks = detect_guitar_attacks(y, sr)

    if debug:
        print("\nPLUCK ATTACKS:")
        for a in attacks:
            print(
                f"  {a['time']:.3f}s strength={a['strength']:.2f}"
            )

    raw_notes = snap_notes_to_attacks(
        raw_notes,
        attacks
    )

    onset_detector = OnsetDetector(y, sr)

    # Recover same-pitch replucks that basic_pitch's onset model missed --
    # see inject_missed_replucks docstring.
    raw_notes = inject_missed_replucks(raw_notes, attacks, onset_detector, debug=debug)

    tracker = StringTracker(FRETBOARD, onset_detector, debug=debug)
    accepted_notes = tracker.process(raw_notes)

    chords = group_into_chords(accepted_notes, max_span=0.13)
    chord_events = chords_to_events(chords)
    refined = refine_positions(chord_events, FRETBOARD)
    tab_text, events = notes_to_tab(refined)

    duration = float(librosa.get_duration(y=y, sr=sr))
    for i, ev in enumerate(events):
        ev["end_time"] = events[i + 1]["time"] if i + 1 < len(events) else duration

    return {
        "chords": [{"time": c["time"], "notes": c["notes"]} for c in chord_events],
        "tab": tab_text,
        "events": events,
        "duration": duration,
    }


if __name__ == "__main__":
    if len(sys.argv) >= 4 and sys.argv[2] == "--inspect":
        filepath = sys.argv[1]
        t_start = float(sys.argv[3])
        t_end = float(sys.argv[4]) if len(sys.argv) > 4 else t_start + 1.0
        inspect_raw_activations(filepath, t_start, t_end)
        sys.exit(0)

    if len(sys.argv) not in (2, 3):
        print(f"Usage: python {sys.argv[0]} <audio_file> [--debug]")
        print(f"       python {sys.argv[0]} <audio_file> --inspect <t_start> [<t_end>]")
        sys.exit(1)

    filepath = sys.argv[1]
    debug_mode = len(sys.argv) == 3 and sys.argv[2] == "--debug"
    result = audio_to_tab(filepath, debug=debug_mode)

    for ev in result["events"]:
        print(f"{ev['time']:.3f}s -> {ev['end_time']:.3f}s  {ev['chord_name']}  {ev['frets']}")
    for c in result["chords"]:
        print(f"{c['time']}s: {c['notes']}")

    print("=== TAB ===")
    print(result["tab"])