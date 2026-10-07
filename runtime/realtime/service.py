"""Loopback-only model service. Public authentication belongs to the Go API."""
import asyncio
import os
import threading

from fastapi import FastAPI, HTTPException, Request
from session import ProtocolError, Session
from processor import Processor

app = FastAPI()
lock = threading.Lock()
session = None
engine = None
assistant = None
aligner = None


@app.on_event("startup")
def load_models():
    global engine, assistant, aligner
    from qwen_asr import Qwen3ASRModel
    from worker_client import Worker
    engine = Qwen3ASRModel.LLM(
        model=os.environ["REALTIME_QWEN_MODEL"],
        gpu_memory_utilization=0.15, max_model_len=4096,
        max_new_tokens=256, enforce_eager=True,
    )
    try:
        assistant = Worker()
        aligner = Worker(python=os.environ["REALTIME_ALIGNER_PYTHON"], script="alignment.py", args=("--align-only",))
        warm_models()
    except Exception:
        unload_models()
        raise


def warm_models():
    # Warm kernels before reporting readiness; generated dummy text is discarded.
    import numpy as np
    warm_audio = np.zeros(16000, dtype=np.float32)
    state = engine.init_streaming_state(chunk_size_sec=1.0)
    engine.streaming_transcribe(warm_audio, state)
    engine.finish_streaming_transcribe(state)
    assistant.push(bytes(32000))
    assistant.finish()
    aligner.align(warm_audio, "测试", "Chinese", 0)
    assistant.reset()


@app.on_event("shutdown")
def unload_models():
    global assistant, engine, aligner
    if session is not None and not session.closed:
        session.control("cancel")
    if aligner is not None:
        aligner.close()
        aligner = None
    if assistant is not None:
        assistant.close()
        assistant = None
    if engine is not None:
        engine.model.llm_engine.engine_core.shutdown()
        engine = None


@app.get("/status")
def status():
    return dict(available=engine is not None and not (session and session.failed), max_sessions=1, max_duration=1800)


@app.post("/sessions")
def start():
    global session
    with lock:
        if session and not session.closed and session.clock() - session.touched < 60:
            raise HTTPException(409, "Another realtime session is active")
        if session and not session.closed:
            session.control("cancel")
        if session and (session.thread.is_alive() or session.failed):
            # Do not reset shared models while an expired inference is still running.
            raise HTTPException(409, "Previous session is still shutting down; restart model service after inference failure")
        session = Processor(Session(engine, assistant, aligner=aligner))
        return session.result()


@app.post("/sessions/{identifier}/{action}")
async def update(identifier: str, action: str, request: Request):
    # Read the bounded body before taking the inference lock.
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 64000:
            raise HTTPException(413, "PCM chunk too large")
    with lock:
        current = session
        if not current or current.id != identifier:
            raise HTTPException(404, "Unknown realtime session")
    try:
        if action == "chunk":
            return current.push(int(request.query_params["sequence"]), bytes(body))
        if action in ("finish", "pause", "cancel"):
            return await asyncio.to_thread(current.control, action)
        if action in ("heartbeat", "result"):
            return current.control(action)
        raise ProtocolError("Unknown action")
    except (ProtocolError, ValueError, KeyError) as exc:
        raise HTTPException(409, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(503, "Model operation failed or timed out; saved audio and text retained") from exc


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("REALTIME_PORT", "18499")))
