"""
tasks.py 

The transcription job.
"""
import os
from pitch import audio_to_tab


def run_transcription(filepath: str, filename: str) -> dict:
    """
    Runs the audio -> guitar tab pipeline and returns a JSON-serializable
    result dict. RQ stores whatever this function returns as the job's
    `result`, retrievable later via Job.fetch(job_id).result.

    Runs inside the RQ worker process, not the Flask API process, so
    this can take as long as it needs to.
    """
    result = audio_to_tab(filepath)
    result["audio_url"] = f"/uploads/{filename}"
    return result


def cleanup_upload(filepath: str) -> None:
    try:
        os.remove(filepath)
    except FileNotFoundError:
        pass