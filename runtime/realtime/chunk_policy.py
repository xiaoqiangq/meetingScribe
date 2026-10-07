"""Incremental confirmation policy using the existing upload planner's limits.

Transport packet edges never imply sentence or paragraph edges. The streaming
engine retains its state while an endpoint/change is still provisional.
"""
import os
from pathlib import Path
import sys

sys.path.insert(0, os.getenv('REALTIME_SHARED_FUNASR', str(Path(__file__).resolve().parents[1] / 'funasr')))
from chunk_manager import MIN_CHUNK_S, TARGET_CHUNK_S, MAX_CHUNK_S, LONG_SILENCE_S


class StreamingChunkManager:
    def __init__(self):
        self.reset()

    def reset(self):
        self.silence_start = None

    def decide(self, start, now, advice):
        if advice.get('endpoint'):
            self.silence_start = advice.get('speech_end') if advice.get('speech_end') is not None else now
        elif advice.get('voiced'):
            self.silence_start = None
        elapsed = now - start
        if elapsed >= MAX_CHUNK_S:
            return 'max_context'
        if self.silence_start is not None:
            silence = now - self.silence_start
            # Short utterances remain live until silence is clearly sustained;
            # normal chunks prefer the upload planner's minimum/target region.
            if silence >= LONG_SILENCE_S and (elapsed >= MIN_CHUNK_S or silence >= 3):
                return 'long_silence'
        if elapsed >= TARGET_CHUNK_S and advice.get('endpoint'):
            return 'vad_gap'
        return None
