export function formatTime(t: number) {
  if (!isFinite(t) || t < 0) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export function downloadBlob(content: BlobPart, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const ACCEPTED_TYPES = ["audio/wav", "audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/m4a", "video/mp4"];
export const MAX_FILE_SIZE_MB = 50;

export function validateAudioFile(candidate: File): string | null {
  const sizeMB = candidate.size / (1024 * 1024);
  if (sizeMB > MAX_FILE_SIZE_MB) {
    return `File is ${sizeMB.toFixed(1)}MB - max is ${MAX_FILE_SIZE_MB}MB.`;
  }
  const looksAudioLike =
    ACCEPTED_TYPES.includes(candidate.type) ||
    /\.(wav|mp3|m4a|mp4)$/i.test(candidate.name);
  if (!looksAudioLike) {
    return "Unsupported file type. Use wav, mp3, m4a, or mp4.";
  }
  return null;
}