"""
worker.py 

Worker process.
"""
import os
from redis import Redis
from rq import Queue
from rq.worker import SimpleWorker

import tasks  # noqa: F401  (registers run_transcription for RQ to resolve)
from pitch import _get_basic_pitch_model


def main():
    print("Worker preloading basic_pitch model before accepting jobs!!!", flush=True)
    _get_basic_pitch_model()

    redis_conn = Redis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379"))
    queue = Queue("transcription", connection=redis_conn)

    print("Worker starting RQ SimpleWorker, listening on 'transcription' queue...", flush=True)
    worker = SimpleWorker([queue], connection=redis_conn)
    worker.work()


if __name__ == "__main__":
    main()