"""CPU-only lifecycle manager; exiting the child releases all CUDA contexts."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid


class ModelHost:
    def __init__(self, idle_seconds=300, load_seconds=480, port=18500, clock=time.monotonic):
        if idle_seconds < 1 or load_seconds < 1 or not 1024 <= port <= 65535:
            raise ValueError("Invalid realtime lifecycle configuration")
        self.idle_seconds, self.load_seconds, self.port = idle_seconds, load_seconds, port
        self.clock = clock
        self.lock = threading.RLock()
        self.process = None
        self.state = "cold"
        self.active_id = None
        self.touched = self.last_used = clock()
        self.stopped = threading.Event()
        self.instance = None

    def status(self):
        # Never wait for the loading lock or load models merely to check status.
        return dict(available=True, model_state=self.state,
                    models_loaded=self.state == "ready", idle_unload_seconds=self.idle_seconds,
                    max_sessions=1, max_duration=1800)

    def _request(self, path, body=None, timeout=60):
        request = urllib.request.Request(f"http://127.0.0.1:{self.port}" + path,
                                         data=body, method="GET" if path == "/status" else "POST",
                                         headers={"Content-Type": "application/octet-stream"})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.status, response.read(8 << 20)
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read(8 << 20)

    def _spawn(self):
        self.instance = uuid.uuid4().hex
        env = dict(os.environ, REALTIME_MODEL_PORT=str(self.port), REALTIME_MODEL_INSTANCE=self.instance)
        return subprocess.Popen([sys.executable, str(Path(__file__).with_name("model_service.py"))],
                                env=env, start_new_session=True)

    def _stop(self):
        self.state = "stopping"
        process = self.process
        if process is not None:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                pass
            # Workers can outlive their parent; terminate the dedicated group too.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait(timeout=15)
        self.process = None
        self.active_id = None
        self.state = "cold"

    def _ensure_ready(self):
        if self.process is not None and self.process.poll() is None and self.state == "ready":
            try:
                code, data = self._request("/status", timeout=2)
                if code == 200 and json.loads(data).get("available"):
                    return
            except (OSError, ValueError):
                pass
        if self.process is not None:
            self._stop()
        self.state = "loading"
        try:
            self.process = self._spawn()
            deadline = self.clock() + self.load_seconds
            while not self.stopped.is_set() and self.clock() < deadline:
                if self.process.poll() is not None:
                    raise RuntimeError("Realtime model process exited while loading")
                try:
                    code, data = self._request("/status", timeout=2)
                    reply = json.loads(data)
                    if code == 200 and reply.get("available") and reply.get("model_instance") == self.instance:
                        self.state = "ready"
                        return
                except (OSError, ValueError):
                    pass
                self.stopped.wait(1)
            raise TimeoutError("Realtime model loading timed out")
        except Exception:
            self._stop()
            self.state = "error"
            raise

    def call(self, path, body=b""):
        with self.lock:
            if path == "/sessions":
                self._ensure_ready()
            elif self.state != "ready":
                return 404, b'{"detail":"Session expired; saved audio and text retained"}'
            code, data = self._request(path, body)
            if code == 200:
                reply = json.loads(data)
                now = self.clock()
                self.last_used = now
                if path == "/sessions":
                    self.active_id = reply["id"]
                    self.touched = now
                elif path.split("?")[0].startswith(f"/sessions/{self.active_id}/"):
                    self.touched = now
                    if reply.get("finished") or reply.get("cancelled") or path.endswith("/cancel"):
                        self.active_id = None
            return code, data

    def reap(self):
        with self.lock:
            if self.state != "ready":
                return
            now = self.clock()
            if self.active_id is not None:
                # Heartbeats preserve paused meetings. A vanished browser cannot
                # pin models forever; cancel before releasing its model process.
                if now - self.touched <= 120:
                    return
                try:
                    self._request(f"/sessions/{self.active_id}/cancel", b"")
                except (OSError, ValueError):
                    pass
                self.active_id = None
                self.last_used = now
            if now - self.last_used >= self.idle_seconds:
                self._stop()

    def monitor(self):
        while not self.stopped.wait(2):
            try:
                self.reap()
            except Exception:
                import traceback
                traceback.print_exc()

    def close(self):
        self.stopped.set()
        with self.lock:
            self._stop()
