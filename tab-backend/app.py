import os
import time
import uuid
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from redis import Redis
from rq import Queue
from rq.job import Job

JOB_FUNCTION_PATH = "tasks.run_transcription"

app = Flask(__name__)
CORS(app)

UPLOAD_DIR = "uploads"
MAX_AGE_SECONDS = 6 * 3600  # keep files for 6 hours then remove
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024  # 25MB upload cap

os.makedirs(UPLOAD_DIR, exist_ok=True)

redis_conn = Redis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379"))
job_queue = Queue("transcription", connection=redis_conn, default_timeout=600)

def cleanup_old_uploads():
    cutoff = time.time() - MAX_AGE_SECONDS
    for f in os.listdir(UPLOAD_DIR):
        path = os.path.join(UPLOAD_DIR, f)
        try:
            if os.path.isfile(path) and os.path.getmtime(path) < cutoff:
                os.remove(path)
        except FileNotFoundError:
            pass


def save_upload(audio_file):
    ext = os.path.splitext(audio_file.filename or "")[1] or ".wav"
    filename = f"{uuid.uuid4()}{ext}"
    path = os.path.join(UPLOAD_DIR, filename)
    audio_file.save(path)
    return path, filename


@app.route("/analyze", methods=["POST"])
def analyze():
    """
    Accepts the upload, enqueues the transcription job into Redis, and
    returns immediately with a job_id.
    """
    if "audio" not in request.files:
        return jsonify({"error": "No audio file provided"}), 400

    audio = request.files["audio"]
    filepath, filename = save_upload(audio)

    job = job_queue.enqueue(JOB_FUNCTION_PATH, filepath, filename)

    return jsonify({"job_id": job.id}), 202


@app.route("/status/<job_id>")
def status(job_id):
    """
    Reads the job's current state directly from Redis via RQ's Job class.
    """
    try:
        job = Job.fetch(job_id, connection=redis_conn)
    except Exception:
        return jsonify({"error": "unknown job_id"}), 404

    if job.is_finished:
        return jsonify({"status": "done", "result": job.result})
    if job.is_failed:
        return jsonify({"status": "error", "error": str(job.exc_info)})
    if job.is_started:
        return jsonify({"status": "processing"})
    return jsonify({"status": "queued"})


@app.route("/uploads/<path:filename>")
def uploaded_file(filename):
    return send_from_directory(UPLOAD_DIR, filename)


@app.before_request
def _occasional_cleanup():
    last = redis_conn.get("last_cleanup")
    now = time.time()
    if last is None or now - float(last) > 3600:
        redis_conn.set("last_cleanup", now)
        cleanup_old_uploads()


if __name__ == "__main__":
    app.run(debug=True, port=5002)