import os
import time
import uuid
import threading
from flask import Flask, request, jsonify, send_from_directory
from pitch import audio_to_tab
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

UPLOAD_DIR = "uploads"
MAX_AGE_SECONDS = 6 * 3600  # keep files for 6 hours then remove

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


app.config['MAX_CONTENT_LENGTH'] = 25 * 1024 * 1024
@app.route("/analyze", methods=["POST"])
def analyze():
    audio = request.files["audio"]
    ext = os.path.splitext(audio.filename or "")[1] or ".wav"
    filename = f"{uuid.uuid4()}{ext}"
    path = os.path.join(UPLOAD_DIR, filename)
    audio.save(path)

    result = audio_to_tab(path)
    result["audio_url"] = f"/uploads/{filename}"

    return jsonify(result)


@app.route("/uploads/<path:filename>")
def uploaded_file(filename):
    return send_from_directory(UPLOAD_DIR, filename)


if __name__ == "__main__":
    threading.Thread(target=cleanup_loop, daemon=True).start()
    app.run(debug=True, port=5002)