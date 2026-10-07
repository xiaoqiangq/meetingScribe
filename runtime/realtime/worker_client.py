"""Isolate NeMo/Transformers dependencies from vLLM's PyTorch environment."""
import base64
import json
import os
from pathlib import Path
import subprocess


class Worker:
    def __init__(self, python=None, script="assistant.py"):
        self.process = subprocess.Popen(
            [python or os.environ["REALTIME_ASSISTANT_PYTHON"], str(Path(__file__).with_name(script))],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1,
        )
        self.call("ready")

    def call(self, action, **fields):
        self.process.stdin.write(json.dumps(dict(action=action, **fields)) + "\n")
        self.process.stdin.flush()
        line = self.process.stdout.readline()
        if not line:
            raise RuntimeError("Realtime speaker worker stopped")
        result = json.loads(line)
        if "error" in result:
            raise RuntimeError(result["error"])
        return result

    def close(self):
        if self.process.poll() is not None:
            return
        self.process.stdin.close()
        try:
            self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=10)

    def reset(self):
        return self.call("reset")

    def push(self, pcm):
        return self.call("chunk", pcm=base64.b64encode(pcm).decode())

    def finish(self):
        return self.call("finish")

    def relabel(self, words):
        return self.call("relabel", words=words)

    def align(self, audio, text, language, offset):
        return self.call("align", pcm=base64.b64encode((audio * 32768).clip(-32768, 32767).astype("<i2").tobytes()).decode(),
                         text=text, language=language or "Chinese", offset=offset)
