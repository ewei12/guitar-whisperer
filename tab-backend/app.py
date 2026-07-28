import os
import time
import uuid
import modal
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

UPLOAD_DIR = "uploads"
MAX_AGE_SECONDS = 6 * 3600
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024

os.makedirs(UPLOAD_DIR, exist_ok=True)

MODAL_APP_NAME = "guitar-whisperer"
transcribe_fn = modal.Function.from_name(MODAL_APP_NAME, "transcribe")

_last_cleanup = 0


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
    if "audio" not in request.files:
        return jsonify({"error": "No audio file provided"}), 400

    audio = request.files["audio"]
    filepath, filename = save_upload(audio)

    with open(filepath, "rb") as f:
        audio_bytes = f.read()

    call = transcribe_fn.spawn(audio_bytes, filename)

    return jsonify({"job_id": call.object_id}), 202


@app.route("/status/<job_id>")
def status(job_id):
    try:
        call = modal.FunctionCall.from_id(job_id)
    except Exception:
        return jsonify({"error": "unknown job_id"}), 404

    try:
        result = call.get(timeout=0)
        return jsonify({"status": "done", "result": result})
    except TimeoutError:
        return jsonify({"status": "processing"})
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)})


@app.route("/uploads/<path:filename>")
def uploaded_file(filename):
    return send_from_directory(UPLOAD_DIR, filename)


@app.before_request
def _occasional_cleanup():
    global _last_cleanup
    now = time.time()
    if now - _last_cleanup > 3600:
        _last_cleanup = now
        cleanup_old_uploads()


if __name__ == "__main__":
    app.run(debug=True, port=5002)