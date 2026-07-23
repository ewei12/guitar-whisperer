import os
import time
import uuid
import threading
import queue
from flask import Flask, request, jsonify, send_from_directory
from pitch import audio_to_tab
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

UPLOAD_DIR = "uploads"
MAX_AGE_SECONDS = 6 * 3600  # keep files for 6 hours then remove
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024  # 25MB upload cap

os.makedirs(UPLOAD_DIR, exist_ok=True)


def cleanup_old_uploads():
    cutoff = time.time() - MAX_AGE_SECONDS
    for f in os.listdir(UPLOAD_DIR):
        path = os.path.join(UPLOAD_DIR, f)
        try:
            if os.path.isfile(path) and os.path.getmtime(path) < cutoff:
                os.remove(path)
        except FileNotFoundError:
            pass  # another worker/thread already cleaned it up


def cleanup_loop():
    while True:
        cleanup_old_uploads()
        time.sleep(3600)  # run hourly


def save_upload(audio_file):
    """Same naming scheme /analyze used to use inline: random name, keep
    the original extension so librosa/basic_pitch can still sniff format."""
    ext = os.path.splitext(audio_file.filename or "")[1] or ".wav"
    filename = f"{uuid.uuid4()}{ext}"
    path = os.path.join(UPLOAD_DIR, filename)
    audio_file.save(path)
    return path, filename


# -------- Job Queue --------
# maxsize is the hard cap on how many jobs can be waiting at once.
    # When full, new requests get a clean 503 instead of piling on and risking
    # an OOM.
job_queue = queue.Queue(maxsize=10)
jobs = {}  # job_id -> {"status": "queued"|"processing"|"done"|"error", "result": ..., "error": ...}


def worker_loop():
    while True:
        job_id, filepath, filename = job_queue.get()
        jobs[job_id]["status"] = "processing"
        try:
            result = audio_to_tab(filepath)
            result["audio_url"] = f"/uploads/{filename}"
            jobs[job_id]["status"] = "done"
            jobs[job_id]["result"] = result
        except Exception as e:
            jobs[job_id]["status"] = "error"
            jobs[job_id]["error"] = str(e)
        finally:
            job_queue.task_done()


@app.route("/analyze", methods=["POST"])
def analyze():
    """Accepts the upload, enqueues the actual transcription work, and
    returns immediately with a job_id. This used to call audio_to_tab
    directly here and block the whole request/worker until it finished --
    that's what let one slow upload stall everyone else behind it."""
    audio = request.files["audio"]
    filepath, filename = save_upload(audio)

    job_id = str(uuid.uuid4())
    jobs[job_id] = {"status": "queued"}
    try:
        job_queue.put_nowait((job_id, filepath, filename))
    except queue.Full:
        del jobs[job_id]
        return jsonify({"error": "Server is at capacity, please try again shortly"}), 503

    return jsonify({"job_id": job_id}), 202


@app.route("/status/<job_id>")
def status(job_id):
    job = jobs.get(job_id)
    if job is None:
        return jsonify({"error": "unknown job_id"}), 404
    return jsonify(job)


@app.route("/uploads/<path:filename>")
def uploaded_file(filename):
    return send_from_directory(UPLOAD_DIR, filename)


threading.Thread(target=worker_loop, daemon=True).start()
threading.Thread(target=cleanup_loop, daemon=True).start()


if __name__ == "__main__":
    app.run(debug=True, port=5002)