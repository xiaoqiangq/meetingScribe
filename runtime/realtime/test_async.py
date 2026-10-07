import threading
import time
import unittest

from processor import Processor
from session import ProtocolError, Session
from test_session import Assistant, Engine

PCM = b'\x00\x10' * 16000


def wait_for(predicate):
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(.005)
    raise AssertionError('background operation did not complete')


class DelayedAligner:
    def __init__(self):
        self.started, self.release = threading.Event(), threading.Event()

    def align(self, audio, text, language, offset):
        self.started.set()
        if not self.release.wait(3):
            raise TimeoutError('test alignment gate')
        return dict(words=[dict(word=text, start=offset, end=offset+len(audio)/16000,
                               speaker='speaker_0')],
                    segments=[dict(text=text, start=offset, end=offset+len(audio)/16000,
                                   speaker='speaker_0')])


class AsyncTest(unittest.TestCase):
    def test_confirmed_text_and_next_audio_do_not_wait_for_alignment(self):
        aligner = DelayedAligner()
        session = Session(Engine(), Assistant(), aligner=aligner)
        try:
            session.push(0, PCM)
            session.commit()
            self.assertTrue(aligner.started.wait(1))
            self.assertEqual(session.result()['text'], '测试')
            self.assertEqual(session.result()['segments'][0]['alignment_status'], 'pending')
            self.assertEqual(session.result()['segments'][0]['speaker_status'], 'pending')
            reply = session.push(1, PCM)
            self.assertEqual(reply['duration'], 2)
            self.assertEqual(reply['partial']['text_status'], 'draft')
            aligner.release.set()
            final = session.finish()
            self.assertEqual(final['segments'][0]['speaker_status'], 'confirmed')
            self.assertEqual(final['metadata']['pending_alignment'], 0)
            self.assertEqual(final['text'], '测试测试')
        finally:
            aligner.release.set()
            session.cancel()

    def test_alignment_failure_retains_confirmed_text_and_continues(self):
        class FailingAligner:
            def align(self, *args):
                raise RuntimeError('alignment unavailable')
        session = Session(Engine(), Assistant(), aligner=FailingAligner())
        session.push(0, PCM)
        session.commit()
        session.push(1, PCM)
        final = session.finish()
        self.assertEqual(final['text'], '测试测试')
        self.assertTrue(final['finished'])
        self.assertTrue(all(s['alignment_status'] == 'unavailable' for s in final['segments']))

    def test_audio_ack_and_retry_are_independent_of_slow_inference(self):
        class SlowEngine(Engine):
            def __init__(self):
                super().__init__()
                self.started, self.release = threading.Event(), threading.Event()
            def streaming_transcribe(self, *args):
                self.started.set()
                self.release.wait(3)
                super().streaming_transcribe(*args)
        engine = SlowEngine()
        processor = Processor(Session(engine, Assistant()))
        try:
            first = processor.push(0, PCM)
            self.assertTrue(engine.started.wait(1))
            self.assertEqual(first['received_sequence'], 1)
            self.assertEqual(processor.push(0, PCM)['received_sequence'], 1)
            self.assertEqual(processor.push(1, PCM)['received_sequence'], 2)
            self.assertEqual(processor.result()['sequence'], 0)
            self.assertEqual(processor.result()['pending_audio_seconds'], 2)
            with self.assertRaises(ProtocolError):
                processor.push(3, PCM)
            engine.release.set()
            wait_for(lambda: processor.result()['sequence'] == 2)
            self.assertEqual(engine.fed, 32000)
        finally:
            engine.release.set()
            processor.control('cancel')
            processor.thread.join(3)

    def test_finish_is_pollable_and_waits_for_alignment_without_blocking_results(self):
        aligner = DelayedAligner()
        processor = Processor(Session(Engine(), Assistant(), aligner=aligner))
        try:
            processor.push(0, PCM)
            processor.control('pause')
            self.assertTrue(aligner.started.wait(1))
            pending = processor.control('finish')
            self.assertFalse(pending['finished'])
            self.assertEqual(processor.control('result')['text'], '测试')
            self.assertFalse(processor.control('finish')['finished'])
            aligner.release.set()
            wait_for(lambda: processor.result()['finished'])
            self.assertEqual(processor.control('finish')['word_segments'][0]['speaker_status'], 'confirmed')
        finally:
            aligner.release.set()
            processor.control('cancel')
            processor.thread.join(3)

    def test_alignment_backlog_is_bounded_without_losing_text(self):
        aligner = DelayedAligner()
        session = Session(Engine(), Assistant(), aligner=aligner)
        try:
            for i in range(6):
                session.push(i, PCM)
                session.commit()
            self.assertEqual(session.result()['metadata']['pending_alignment'], 4)
            self.assertEqual(session.result()['text'], '测试'*6)
            self.assertEqual(session.result()['segments'][-1]['alignment_status'], 'unavailable')
        finally:
            aligner.release.set()
            session.cancel()

    def test_inference_failure_does_not_close_before_alignment_cleanup(self):
        from contextlib import redirect_stderr
        from concurrent.futures import ThreadPoolExecutor
        from io import StringIO

        class FailingSession:
            id = 'failed-session'
            clock = staticmethod(time.monotonic)
            def __init__(self):
                self.cleaning, self.release = threading.Event(), threading.Event()
            def result(self):
                return dict(sequence=0, text='retained', finished=False)
            def push(self, *args):
                raise RuntimeError('expected test failure')
            def refresh(self):
                pass
            def cancel(self):
                self.cleaning.set()
                self.release.wait(3)
        session = FailingSession()
        with redirect_stderr(StringIO()):
            processor = Processor(session)
            try:
                processor.push(0, PCM)
                self.assertTrue(session.cleaning.wait(1))
                self.assertFalse(processor.closed)
                self.assertIn('error', processor.result())
                with ThreadPoolExecutor(max_workers=1) as pool:
                    pending = pool.submit(processor.control, 'cancel')
                    try:
                        self.assertFalse(pending.done())
                    finally:
                        session.release.set()
                    self.assertEqual(pending.result(timeout=3)['text'], 'retained')
            finally:
                session.release.set()
                processor.thread.join(3)
            self.assertTrue(processor.closed)
