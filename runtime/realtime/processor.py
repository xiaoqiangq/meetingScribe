"""Ordered inference queue: receiving PCM never waits for a model call."""
from collections import deque
from concurrent.futures import Future
from copy import deepcopy
import threading

from session import ProtocolError


class Processor:
    max_pending_samples = 8 * 16000

    def __init__(self, session):
        self.session = session
        self.id = session.id
        self.clock = session.clock
        self.touched = self.clock()
        self.closed = False
        self.failed = False
        self.finishing = False
        self.revision = 0
        self.received = 0
        self.samples = 0
        self.pending_samples = 0
        self.last_pcm = None
        self.queue = deque()
        self.condition = threading.Condition()
        self.snapshot = session.result()
        self.thread = threading.Thread(target=self._run, daemon=True, name="live-inference")
        self.thread.start()

    def result(self):
        with self.condition:
            result = deepcopy(self.snapshot)
            result["revision"] = self.revision
            result["received_sequence"] = self.received
            result["pending_audio_seconds"] = self.pending_samples / 16000
            if self.failed:
                result["error"] = "Model inference failed; saved audio and confirmed text retained"
            return result

    def push(self, sequence, pcm):
        with self.condition:
            if self.closed or self.failed or self.finishing:
                raise ProtocolError("Session no longer accepts audio")
            if sequence == self.received - 1 and pcm == self.last_pcm:
                self.touched = self.clock()
            else:
                if sequence != self.received:
                    raise ProtocolError("Unexpected audio sequence; retry the missing chunk")
                if not pcm or len(pcm) % 2 or len(pcm) > 64000:
                    raise ProtocolError("Invalid PCM16 audio")
                samples = len(pcm)//2
                if self.samples + samples > 16000*1800:
                    raise ProtocolError("Session limit is 30 minutes")
                if self.pending_samples + samples > self.max_pending_samples:
                    raise ProtocolError("Transcription is falling behind; finish and retain saved audio")
                self.received += 1
                self.samples += samples
                self.pending_samples += samples
                self.last_pcm = pcm
                self.touched = self.clock()
                self.queue.append(("chunk", (sequence, pcm), None))
                self.condition.notify()
        return self.result()

    def control(self, action):
        with self.condition:
            self.touched = self.clock()
            if action == "heartbeat" or action == "result":
                pass
            elif self.closed:
                if action not in ("finish", "cancel"):
                    raise ProtocolError("Session already finished")
            elif self.finishing:
                future = self.terminal_future
            else:
                future = Future()
                if action in ("finish", "cancel"):
                    self.finishing = True
                    self.terminal_future = future
                self.queue.append((action, (), future))
                self.condition.notify()
        if action in ("heartbeat", "result", "finish") or self.closed:
            return self.result()
        # Waiting callers do not hold the receive/snapshot lock.
        return future.result(timeout=55)

    def _run(self):
        while True:
            with self.condition:
                if not self.queue:
                    self.condition.wait(timeout=.25)
                work = self.queue.popleft() if self.queue else None
            action, args, future = work or ("refresh", (), None)
            try:
                if action == "chunk":
                    self.session.push(*args)
                elif action == "pause":
                    self.session.commit()
                    self.session.refresh()
                elif action == "finish":
                    self.session.finish()
                elif action == "cancel":
                    self.session.cancel()
                else:
                    self.session.refresh()
                snapshot = deepcopy(self.session.result())
                with self.condition:
                    if snapshot != self.snapshot:
                        self.revision += 1
                    self.snapshot = snapshot
                    if action == "chunk":
                        self.pending_samples -= len(args[1])//2
                    if action in ("finish", "cancel"):
                        self.closed = True
                if future:
                    future.set_result(self.result())
                if self.closed:
                    return
            except Exception as exc:
                import traceback
                traceback.print_exc()
                with self.condition:
                    self.failed = self.finishing = True
                    cleanup = self.terminal_future = Future()
                    remaining = list(self.queue)
                    self.queue.clear()
                if future:
                    future.set_exception(exc)
                for _, _, waiting in remaining:
                    if waiting:
                        waiting.set_exception(exc)
                try:
                    self.session.cancel()
                finally:
                    with self.condition:
                        self.closed = True
                    cleanup.set_result(self.result())
                return
