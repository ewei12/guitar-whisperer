import modal

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install_from_requirements("requirements.txt")
    .pip_install("setuptools<81")
    .add_local_python_source("pitch")
)

app = modal.App("guitar-whisperer", image=image)

@app.function(cpu=4, memory=4096, timeout=600)
def transcribe(audio_bytes: bytes, filename: str) -> dict:
    from pitch import audio_to_tab
    import tempfile, os

    with tempfile.NamedTemporaryFile(suffix=os.path.splitext(filename)[1], delete=False) as f:
        f.write(audio_bytes)
        tmp_path = f.name

    result = audio_to_tab(tmp_path)
    os.unlink(tmp_path)
    result["audio_url"] = f"/uploads/{filename}"
    return result


@app.local_entrypoint()
def main(filepath: str):
    with open(filepath, "rb") as f:
        data = f.read()
    filename = filepath.split("/")[-1]
    result = transcribe.remote(data, filename)
    print(result)