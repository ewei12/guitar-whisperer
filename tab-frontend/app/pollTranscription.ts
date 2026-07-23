export type ChordEventResult = {
  time: number;
  end_time: number;
  chord_name: string | null;
  frets: Record<string, number | null>;
  alternatives?: Record<string, number | null>[];
};

export type TranscriptionResult = {
  tab: string;
  notes: any[];
  events: ChordEventResult[];
  duration: number;
  audio_url?: string;
  chords?: { time: number; notes: string[] }[];
};

type JobStatus = {
  status: "queued" | "processing" | "done" | "error";
  result?: TranscriptionResult;
  error?: string;
};

export async function transcribeAudio(
  formData: FormData,
  backendUrl: string,
  { pollIntervalMs = 1500, timeoutMs = 180000 } = {},
): Promise<TranscriptionResult> {
  const submitRes = await fetch(`${backendUrl}/analyze`, {
    method: "POST",
    body: formData,
  });

  if (submitRes.status === 503) {
    throw new Error("Server is at capacity, please try again shortly");
  }
  if (!submitRes.ok) {
    const body = await submitRes.json().catch(() => ({}) as any);
    throw new Error(body.error || `Upload failed (${submitRes.status})`);
  }

  const { job_id } = (await submitRes.json()) as { job_id: string };
  const start = Date.now();

  while (true) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        "Transcription timed out — the queue may be backed up, try again later",
      );
    }

    const statusRes = await fetch(`${backendUrl}/status/${job_id}`);
    if (!statusRes.ok) {
      throw new Error(`Lost track of job ${job_id}`);
    }
    const job = (await statusRes.json()) as JobStatus;

    if (job.status === "done" && job.result) {
      return job.result;
    }
    if (job.status === "error") {
      throw new Error(job.error || "Transcription failed");
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}
