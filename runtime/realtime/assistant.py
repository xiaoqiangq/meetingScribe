"""Persistent Nemotron cache and short-clause alignment, JSON-lines protocol."""
import base64
import contextlib
import json
import os
from pathlib import Path
import sys

# Library progress messages must never contaminate the protocol.
protocol = sys.stdout
sys.stdout = sys.stderr
import numpy as np
import torch
from nemo.collections.asr.models import SortformerEncLabelModel

from worker_client import Worker
from speakers import SpeakerTimeline, group_words


class Assistant:
    def __init__(self):
        self.model = SortformerEncLabelModel.restore_from(
            os.environ["REALTIME_NEMOTRON_MODEL"], map_location="cuda", strict=True).eval()
        modules = self.model.sortformer_modules
        # Nemotron-3 model card's low-latency preset (80 ms encoder frames).
        for key, value in dict(chunk_len=9, chunk_right_context=4, spkcache_len=264,
                               fifo_len=264, spkcache_update_period=222).items():
            setattr(modules, key, value)
        self.model._check_streaming_parameters()
        # Per-window normalization changes earlier features; disable it for streaming.
        self.model.preprocessor.featurizer.normalize = None
        self.model.preprocessor.featurizer.dither = 0.0
        self.aligner = Worker(python=os.environ["REALTIME_ALIGNER_PYTHON"], script="alignment.py")
        self.reset()

    def reset(self):
        m = self.model.sortformer_modules
        self.state = m.init_streaming_state(batch_size=1, async_streaming=self.model.async_streaming,
                                             device=self.model.device)
        self.preds = torch.zeros((1, 0, m.n_spk), device=self.model.device)
        self.raw = np.zeros(0, np.float32)
        self.base_frame = 0
        self.next_frame = 0
        self.samples = 0
        self.timeline = SpeakerTimeline(self.model.output_subsampling_factor*.01)
        self.aligner.reset()
        return {}

    @torch.inference_mode()
    def push(self, pcm, final=False):
        audio = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
        self.raw = np.concatenate([self.raw, audio])
        self.samples += len(audio)
        advice = self.aligner.push(pcm) if len(audio) else dict(voiced=False, endpoint=False)
        m = self.model.sortformer_modules
        factor = m.subsampling_factor
        central, right, left = m.chunk_len * factor, m.chunk_right_context * factor, m.chunk_left_context * factor
        waveform = torch.from_numpy(self.raw).to(self.model.device).unsqueeze(0)
        features, lengths = self.model.preprocessor(input_signal=waveform,
                        length=torch.tensor([len(self.raw)], device=self.model.device))
        available = self.samples // 160  # 10 ms features; exclude unstable trailing STFT frame.
        while self.next_frame < available:
            end = min(self.next_frame + central, available)
            if not final and end + right + 4 > available:
                break
            lo = min(left, self.next_frame)
            ro = min(right, available - end)
            start = self.next_frame - lo - self.base_frame
            stop = end + ro - self.base_frame
            chunk = features[:, :, start:stop].transpose(1, 2)
            self.state, self.preds = self.model.forward_streaming_step(
                processed_signal=chunk,
                processed_signal_length=torch.tensor([chunk.shape[1]], device=self.model.device),
                streaming_state=self.state, total_preds=self.preds,
                left_offset=lo, right_offset=ro)
            self.next_frame = end
        # Keep bounded raw context, including a stable STFT margin.
        keep_from = max(0, self.next_frame - left - 8)
        drop = keep_from - self.base_frame
        if drop > 0:
            self.raw = self.raw[drop * 160:]
            self.base_frame = keep_from
        self.timeline.update(self.preds[0].detach().cpu().numpy())
        advice["speaker"], advice["turn"] = self.timeline.tail()
        return advice

    @torch.inference_mode()
    def align(self, pcm, text, language, offset):
        audio = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
        aligned = self.aligner.align(audio, text, language, offset)
        words = aligned["words"]
        if not words:
            return aligned
        return self.relabel(words)

    def relabel(self, words):
        for word in words:
            word["speaker"] = self.timeline.label_interval(word["start"], word["end"])
        return dict(words=words, segments=group_words(words))


worker = Assistant()
for line in sys.stdin:
    try:
        message = json.loads(line)
        action = message.pop("action")
        if "pcm" in message:
            message["pcm"] = base64.b64decode(message["pcm"], validate=True)
        if action == "ready":
            reply = dict(ready=True)
        elif action == "reset":
            reply = worker.reset()
        elif action == "chunk":
            reply = worker.push(**message)
        elif action == "finish":
            reply = worker.push(b"", final=True)
        elif action == "align":
            reply = worker.align(**message)
        elif action == "relabel":
            reply = worker.relabel(**message)
        else:
            raise ValueError("Unknown worker action")
    except Exception as exc:
        import traceback
        traceback.print_exc(file=sys.stderr)
        reply = dict(error=str(exc))
    protocol.write(json.dumps(reply, ensure_ascii=False) + "\n")
    protocol.flush()
