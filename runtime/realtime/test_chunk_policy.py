import unittest
from chunk_policy import StreamingChunkManager, MIN_CHUNK_S, TARGET_CHUNK_S, MAX_CHUNK_S
from test_session import Assistant, Engine
from session import Session

class ChunkPolicyTest(unittest.TestCase):
    def test_limits_match_existing_upload_policy(self):
        self.assertEqual((MIN_CHUNK_S,TARGET_CHUNK_S,MAX_CHUNK_S),(10,20,30))
        planner=StreamingChunkManager()
        self.assertIsNone(planner.decide(0,20,{'voiced':True}))
        self.assertEqual(planner.decide(0,30,{'voiced':True}),'max_context')

    def test_short_pause_waits_and_resumption_preserves_context(self):
        planner=StreamingChunkManager()
        self.assertIsNone(planner.decide(0,2,{'endpoint':True,'speech_end':1.8}))
        self.assertIsNone(planner.decide(0,3,{'voiced':True}))
        self.assertIsNone(planner.decide(0,4,{'voiced':False}))
        self.assertIsNone(planner.silence_start)

    def test_long_silence_and_short_finished_utterance_confirm(self):
        planner=StreamingChunkManager()
        self.assertIsNone(planner.decide(0,11,{'endpoint':True,'speech_end':10.7}))
        self.assertEqual(planner.decide(0,13,{'voiced':False}),'long_silence')
        planner.reset()
        planner.decide(20,22,{'endpoint':True,'speech_end':21.8})
        self.assertEqual(planner.decide(20,25,{'voiced':False}),'long_silence')

    def test_turn_cut_waits_for_lookahead(self):
        planner=StreamingChunkManager()
        self.assertIsNone(planner.decide(0,6,{'voiced':True,'turn':('speaker_1',5)}))
        self.assertIsNone(planner.decide(0,6.5,{'voiced':True,'turn':('speaker_1',5)}))
        self.assertEqual(planner.decide(0,7,{'voiced':True,'turn':('speaker_1',5)}),'sustained_speaker_change')

    def test_session_endpoints_do_not_reset_qwen_every_short_clause(self):
        class Pauses(Assistant):
            def push(self,pcm):
                self.fed+=len(pcm)//2
                now=self.fed/16000
                return {'voiced':True,'endpoint':True,'speech_end':now}
        engine,assistant=Engine(),Pauses();s=Session(engine,assistant)
        for i in range(8):s.push(i,b'\x00\x10'*16000)
        self.assertEqual(s.segments,[])
        self.assertEqual(engine.fed,8*16000)
        final=s.finish()
        self.assertEqual(final['segments'][0]['start'],0)
        self.assertEqual(final['segments'][0]['end'],8)
        self.assertEqual(final['metadata']['chunk_cuts'][0]['reason'],'audio_end')

    def test_initial_identity_is_not_a_change_or_duplicate_cut(self):
        class Turns(Assistant):
            def push(self,pcm):
                self.fed+=len(pcm)//2
                now=self.fed/16000
                return {'voiced':True,'endpoint':False,'turn':('speaker_0',0) if now<5 else ('speaker_1',4)}
        engine=Engine();s=Session(engine,Turns())
        for i in range(9):s.push(i,b'\x00\x10'*16000)
        final=s.finish()
        self.assertEqual([(c['end'],c['reason']) for c in final['metadata']['chunk_cuts']],[(6,'sustained_speaker_change'),(9,'audio_end')])
        self.assertEqual(engine.fed,9*16000)

if __name__=='__main__':unittest.main()
