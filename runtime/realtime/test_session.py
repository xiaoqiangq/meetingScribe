import unittest
from types import SimpleNamespace

from session import ProtocolError, Session


class Engine:
    def __init__(self):
        self.fed = 0
    def init_streaming_state(self, **options):
        return SimpleNamespace(text="", language=None)
    def streaming_transcribe(self, audio, state):
        self.fed += len(audio)
        state.text = "测试"
        state.language = "Chinese"
    def finish_streaming_transcribe(self, state):
        pass


class Assistant:
    def reset(self):
        self.fed = 0
    def push(self, pcm):
        self.fed += len(pcm) // 2
    def finish(self):
        pass
    def align(self, audio, text, language, offset):
        return dict(words=[], segments=[dict(text=text, start=offset, end=offset + len(audio)/16000, speaker="speaker_0")])


class SessionTest(unittest.TestCase):
    def setUp(self):
        self.engine, self.assistant = Engine(), Assistant()
        self.session = Session(self.engine, self.assistant)
        self.pcm = b"\x00\x10" * 16000

    def test_retry_does_not_duplicate_audio(self):
        reply = self.session.push(0, self.pcm)
        self.assertEqual(reply, self.session.push(0, self.pcm))
        self.assertEqual(self.engine.fed, 16000)
        self.assertEqual(self.assistant.fed, 16000)

    def test_reordering_and_changed_retry_are_rejected(self):
        self.session.push(0, self.pcm)
        for sequence, pcm in [(2, self.pcm), (0, b"\x00\x20"*16000)]:
            with self.assertRaises(ProtocolError):
                self.session.push(sequence, pcm)
        self.assertEqual(self.session.sequence, 1)

    def test_final_tail_and_finish_are_idempotent(self):
        self.session.push(0, self.pcm[:1700])
        final = self.session.finish()
        self.assertEqual(final, self.session.finish())
        self.assertEqual(final["segments"][0]["end"], 850/16000)
        with self.assertRaises(ProtocolError):
            self.session.push(1, self.pcm)

    def test_context_rollover_preserves_sample_count_and_absolute_time(self):
        for i in range(33):
            self.session.push(i, self.pcm)
        final = self.session.finish()
        self.assertEqual(final["duration"], 33)
        self.assertEqual(self.engine.fed, 33*16000)
        self.assertEqual([(s["start"],s["end"]) for s in final["segments"]], [(0,30),(30,33)])

    def test_invalid_pcm_and_duration_limit(self):
        for pcm in [b"", b"a", b"a"*64002]:
            with self.assertRaises(ProtocolError): self.session.push(0,pcm)
        self.session.samples = 1800*16000
        with self.assertRaises(ProtocolError): self.session.push(0,self.pcm)

    def test_final_language_survives_state_reset(self):
        self.session.push(0,self.pcm)
        self.session.state.language="English"
        self.assertEqual(self.session.finish()["language"],"en")


if __name__ == "__main__":
    unittest.main()
