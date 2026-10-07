"""Bounded, ordered streaming sessions; no model or network dependencies."""
import time
import uuid
from chunk_policy import StreamingChunkManager


class ProtocolError(ValueError):
    pass


class Session:
    def __init__(self, engine, assistant, clock=time.monotonic):
        self.id = str(uuid.uuid4())
        self.engine, self.assistant, self.clock = engine, assistant, clock
        self.created = self.touched = clock()
        self.sequence = 0
        self.samples = 0
        self.offset = 0
        self.audio = []
        self.segments = []
        self.words = []
        self.closed = False
        self.last_reply = None
        self.last_pcm = None
        self.pre_roll = None
        self.partial_speaker = None
        self.chunk_manager = StreamingChunkManager()
        self.chunk_cuts = []
        self.last_turn_speaker = None
        self.languages = set()
        self.state = engine.init_streaming_state(chunk_size_sec=1.0)
        assistant.reset()

    def push(self, sequence, pcm):
        if self.closed:
            raise ProtocolError("Session already finished")
        # A lost response may be retried without feeding the same audio twice.
        if sequence == self.sequence - 1 and pcm == self.last_pcm:
            self.touched = self.clock()
            return self.last_reply
        if sequence != self.sequence:
            raise ProtocolError("Unexpected audio sequence; retry the missing chunk")
        if not pcm or len(pcm) % 2 or len(pcm) > 64000:
            raise ProtocolError("Expected at most two seconds of 16 kHz mono PCM16")
        if self.samples + len(pcm) // 2 > 16000 * 1800:
            raise ProtocolError("Session limit is 30 minutes; finish and save")
        import numpy as np
        audio = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
        advice = self.assistant.push(pcm) or dict(voiced=True, endpoint=False)
        self.partial_speaker = advice.get("speaker")
        if self.audio or advice["voiced"]:
            if not self.audio and self.pre_roll is not None:
                self.audio.append(self.pre_roll)
                self.offset = self.samples / 16000 - len(self.pre_roll) / 16000
                self.engine.streaming_transcribe(self.pre_roll, self.state)
            self.pre_roll = None
            self.audio.append(audio)
            self.engine.streaming_transcribe(audio, self.state)
        else:
            self.pre_roll = audio
            self.offset = (self.samples + len(audio)) / 16000
        self.samples += len(audio)
        turn = advice.get("turn")
        if turn:
            if self.last_turn_speaker is None:
                self.last_turn_speaker = turn[0]
                advice = {**advice, "turn": None}
            elif turn[0] == self.last_turn_speaker:
                advice = {**advice, "turn": None}
            else:
                self.last_turn_speaker = turn[0]
        reason = self.chunk_manager.decide(self.offset, self.samples / 16000, advice)
        if self.audio and reason:
            self.commit(reason)
        self.sequence += 1
        self.touched = self.clock()
        self.last_pcm = pcm
        self.last_reply = self.result()
        return self.last_reply

    def commit(self, reason="manual_pause"):
        import numpy as np
        if not self.audio:
            return
        self.engine.finish_streaming_transcribe(self.state)
        text = self.state.text.strip()
        if self.state.language:
            self.languages.add(self.state.language)
        if text and self.audio:
            audio = np.concatenate(self.audio)
            result = self.assistant.align(audio, text, self.state.language, self.offset)
            self.segments.extend(result["segments"])
            self.words.extend(result["words"])
        self.chunk_cuts.append(dict(start=self.offset, end=self.samples/16000, reason=reason))
        self.offset = self.samples / 16000
        self.chunk_manager.reset()
        self.audio = []
        self.state = self.engine.init_streaming_state(chunk_size_sec=1.0)
        self.partial_speaker = None

    def finish(self):
        if not self.closed:
            self.assistant.finish()
            self.commit("audio_end")
            # Revisit provisional labels using the final continuous speaker cache.
            # Preserve fallback segments when alignment was unavailable.
            if self.words and hasattr(self.assistant, "relabel"):
                result = self.assistant.relabel(self.words)
                fallback = [s for s in self.segments if s.get("speaker") is None
                            and not any(w["start"] >= s["start"] and w["end"] <= s["end"] for w in self.words)]
                self.words = result["words"]
                self.segments = sorted(result["segments"] + fallback, key=lambda s:s["start"])
            self.closed = True
        self.touched = self.clock()
        return self.result()

    def result(self):
        languages = self.languages | ({self.state.language} if self.state.language else set())
        codes = {"Chinese":"zh", "English":"en", "Cantonese":"yue", "French":"fr",
                 "German":"de", "Italian":"it", "Japanese":"ja", "Korean":"ko",
                 "Portuguese":"pt", "Russian":"ru", "Spanish":"es"}
        language = "mul" if len(languages) > 1 else codes.get(next(iter(languages), ""), "und")
        text = ""
        for segment in self.segments:
            part = segment["text"]
            if text and part and text[-1].isascii() and part[0].isascii() and text[-1].isalnum() and part[0].isalnum():
                text += " "
            text += part
        return dict(id=self.id, sequence=self.sequence, duration=self.samples / 16000,
                    partial=dict(text=self.state.text, start=self.offset,
                                 end=self.samples / 16000, speaker=self.partial_speaker),
                    segments=self.segments, word_segments=self.words,
                    text=text,
                    language=language, finished=self.closed and not getattr(self,"failed",False),
                    model_used="Qwen/Qwen3-ASR-1.7B",
                    metadata=dict(mode="realtime", diarization="Nemotron-3",
                                  speaker_identity="session_only", chunk_manager="incremental-v1",
                                  chunk_cuts=self.chunk_cuts))
