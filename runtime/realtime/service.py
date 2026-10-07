"""Loopback-only model service. Public authentication belongs to the Go API."""
import base64
import os
import threading

from fastapi import FastAPI, HTTPException, Request
from session import ProtocolError, Session

app = FastAPI()
lock = threading.Lock()
session = None
engine = None
assistant = None


@app.on_event("startup")
def load_models():
    global engine, assistant
    from qwen_asr import Qwen3ASRModel
    from worker_client import Worker
    engine = Qwen3ASRModel.LLM(
        model=os.environ["REALTIME_QWEN_MODEL"],
        gpu_memory_utilization=0.15, max_model_len=4096,
        max_new_tokens=256, enforce_eager=True,
    )
    try:
        assistant = Worker()
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
    assistant.align(warm_audio, "测试", "Chinese", 0)
    assistant.reset()


@app.on_event("shutdown")
def unload_models():
    global assistant, engine
    if assistant is not None:
        assistant.close()
        assistant = None
    if engine is not None:
        engine.model.llm_engine.engine_core.shutdown()
        engine = None


@app.get("/status")
def status():
    return dict(available=engine is not None, max_sessions=1, max_duration=1800)


@app.post("/sessions")
def start():
    global session
    with lock:
        if session and not session.closed and session.clock() - session.touched < 60:
            raise HTTPException(409, "Another realtime session is active")
        session = Session(engine, assistant)
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
        if not session or session.id != identifier:
            raise HTTPException(404, "Unknown realtime session")
        if getattr(session, "failed", False):
            raise HTTPException(503, "Model inference failed; download the recording and start a new session")
        try:
            if action == "chunk":
                return session.push(int(request.query_params["sequence"]), bytes(body))
            if action == "finish":
                return session.finish()
            if action == "pause":
                session.commit()
                session.touched = session.clock()
                return session.result()
            if action == "heartbeat":
                session.touched = session.clock()
                return session.result()
            if action == "result":
                if not session.closed:
                    raise ProtocolError("Finish before saving")
                return session.result()
            if action == "cancel":
                session.closed = True
                return dict(cancelled=True)
            raise ProtocolError("Unknown action")
        except (ProtocolError, ValueError, KeyError) as exc:
            raise HTTPException(409, str(exc)) from exc
        except Exception as exc:
            # A partially completed model call cannot safely replay its audio.
            session.closed = True
            session.failed = True
            import traceback
            traceback.print_exc()
            raise HTTPException(503, "Model inference failed; download the recording and start a new session") from exc


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("REALTIME_PORT", "18499")))
