"""Bounded, ordered streaming sessions; no model or network dependencies."""
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from chunk_policy import StreamingChunkManager


class ProtocolError(ValueError):
    pass


class Session:
    def __init__(self, engine, assistant, clock=time.monotonic, aligner=None):
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
        self.aligner = aligner or assistant
        self.alignment_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="live-align")
        self.confirmed = []
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
        reason = self.chunk_manager.decide(self.offset, self.samples / 16000, advice)
        if self.audio and reason:
            self.commit(reason)
        self.sequence += 1
        self.touched = self.clock()
        self.last_pcm = pcm
        self.refresh(relabel=True)
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
            chunk = dict(text=text, start=self.offset, end=self.samples/16000,
                         words=[], segments=[dict(text=text, start=self.offset,
                         end=self.samples/16000, speaker=None)], alignment_status="pending")
            # A bounded alignment backlog must never stop audio capture or lose text.
            if sum(c["alignment_status"] == "pending" for c in self.confirmed) < 4:
                chunk["future"] = self.alignment_pool.submit(self.aligner.align,
                    np.concatenate(self.audio), text, self.state.language, self.offset)
            else:
                chunk["alignment_status"] = "unavailable"
            self.confirmed.append(chunk)
            self.refresh(relabel=True)
        self.chunk_cuts.append(dict(start=self.offset, end=self.samples/16000, reason=reason))
        self.offset = self.samples / 16000
        self.chunk_manager.reset()
        self.audio = []
        self.state = self.engine.init_streaming_state(chunk_size_sec=1.0)
        self.partial_speaker = None

    def refresh(self, wait=False, relabel=False):
        changed = False
        for chunk in self.confirmed:
            future = chunk.get("future")
            if future is None or (not wait and not future.done()):
                continue
            try:
                aligned = future.result()
                chunk["words"] = aligned["words"]
                chunk["segments"] = aligned["segments"]
                chunk["alignment_status"] = "complete" if aligned["words"] else "unavailable"
            except Exception:
                # Recognition remains usable when only timestamp alignment fails.
                chunk["alignment_status"] = "unavailable"
            del chunk["future"]
            changed = True
        if not changed and not relabel:
            return
        self.words, self.segments = [], []
        for chunk in self.confirmed:
            if chunk["words"] and hasattr(self.assistant, "relabel"):
                labelled = self.assistant.relabel(chunk["words"])
                chunk["words"], chunk["segments"] = labelled["words"], labelled["segments"]
            for segment in chunk["segments"]:
                self.segments.append({**segment, "text_status": "confirmed",
                    "alignment_status": chunk["alignment_status"],
                    "speaker_status": ("confirmed" if self.closed and not getattr(self, "failed", False) else "provisional")
                        if segment.get("speaker") else "pending"})
            for word in chunk["words"]:
                self.words.append({**word, "speaker_status": ("confirmed" if self.closed and not getattr(self, "failed", False) else "provisional")
                    if word.get("speaker") else "pending"})

    def finish(self):
        if not self.closed:
            self.assistant.finish()
            self.commit("audio_end")
            self.alignment_pool.shutdown(wait=True)
            self.closed = True
            self.refresh(wait=True, relabel=True)
        self.touched = self.clock()
        return self.result()

    def cancel(self):
        self.failed = True
        self.alignment_pool.shutdown(wait=True, cancel_futures=True)
        self.closed = True
        self.refresh(relabel=True)
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
                    partial=dict(text=self.state.text, text_status="draft", speaker_status="provisional" if self.partial_speaker else "pending", start=self.offset,
                                 end=self.samples / 16000, speaker=self.partial_speaker),
                    segments=self.segments, word_segments=self.words,
                    text=text,
                    language=language, finished=self.closed and not getattr(self,"failed",False),
                    model_used="Qwen/Qwen3-ASR-1.7B",
                    metadata=dict(mode="realtime", diarization="Nemotron-3",
                                  speaker_identity="session_only", chunk_manager="incremental-v2",
                                  pending_alignment=sum(c["alignment_status"] == "pending" for c in self.confirmed),
                                  chunk_cuts=self.chunk_cuts))
