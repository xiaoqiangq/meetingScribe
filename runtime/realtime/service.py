"""Always-on CPU gateway with disposable, on-demand GPU model workers."""
import os
import threading

from fastapi import FastAPI, HTTPException, Request, Response
from model_host import ModelHost

app = FastAPI()
port = int(os.getenv("REALTIME_PORT", "18499"))
host = ModelHost(idle_seconds=int(os.getenv("REALTIME_IDLE_SECONDS", "300")),
                 load_seconds=int(os.getenv("REALTIME_LOAD_SECONDS", "480")),
                 port=int(os.getenv("REALTIME_MODEL_PORT", str(port + 1))))
if host.port == port:
    raise ValueError("Realtime gateway and model ports must differ")


@app.on_event("startup")
def startup():
    threading.Thread(target=host.monitor, daemon=True, name="model-idle-unload").start()


@app.on_event("shutdown")
def shutdown():
    host.close()


@app.get("/status")
def status():
    return host.status()


def forward(path, body=b""):
    try:
        code, data = host.call(path, body)
        return Response(content=data, status_code=code, media_type="application/json")
    except Exception as exc:
        import traceback
        traceback.print_exc()
        raise HTTPException(503, "Realtime model operation failed; retry starting after checking the service") from exc


@app.post("/sessions")
def start():
    return forward("/sessions")


@app.post("/sessions/{identifier}/{action}")
async def update(identifier: str, action: str, request: Request):
    import asyncio
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 64000:
            raise HTTPException(413, "PCM chunk too large")
    query = "?" + str(request.query_params) if request.query_params else ""
    return await asyncio.to_thread(forward, f"/sessions/{identifier}/{action}" + query, bytes(body))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=port)
