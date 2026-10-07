import unittest
import numpy as np
from speakers import choose_speaker, group_words, SpeakerTimeline


class SpeakersTest(unittest.TestCase):
    def test_short_spurious_channel_stays_unresolved(self):
        probs = np.array([[.9,.02]]*400 + [[.01,.95]]*200)
        self.assertIsNone(choose_speaker(probs[-100:],probs,.01))
        self.assertEqual(choose_speaker(probs[:100],probs,.01),"speaker_0")

    def test_sustained_second_speaker_is_not_merged_into_first(self):
        probs = np.array([[.9,.02]]*400 + [[.01,.95]]*400)
        self.assertEqual(choose_speaker(probs[-100:],probs,.01),"speaker_1")

    def test_low_confidence_does_not_publish_an_identity(self):
        probs=np.array([[.52,.48]]*1000)
        self.assertIsNone(choose_speaker(probs,probs,.01))

    def test_grouping_retains_text_and_speaker_turns(self):
        words=[dict(start=i,end=i+1,word=value,speaker=speaker) for i,(value,speaker) in enumerate([('你好，','speaker_0'),('请说。','speaker_0'),('好。','speaker_1')])]
        segments=group_words(words)
        self.assertEqual(''.join(s['text'] for s in segments),'你好，请说。好。')
        self.assertEqual(len(segments),2)

    def test_frame_flicker_does_not_publish_a_turn(self):
        timeline=SpeakerTimeline(.08)
        probs=np.array([[.95,.02]]*50+[[.02,.95]]*50+[[.95,.02]]*50+[[.2,.8]]*2+[[.95,.02]]*10)
        timeline.update(probs)
        self.assertIsNone(timeline.label_interval(12,12.16))
        self.assertEqual(timeline.tail()[0],'speaker_0')
        before=timeline.frames;timeline.update(probs)
        self.assertEqual(timeline.frames,before)

    def test_known_strong_short_interjection_keeps_identity_without_cut(self):
        timeline=SpeakerTimeline(.08)
        timeline.update(np.array([[.95,.02]]*50+[[.02,.95]]*50+[[.95,.02]]*50+[[.02,.97]]*3))
        self.assertEqual(timeline.tail(),('speaker_1',None))
        self.assertEqual(timeline.label_interval(12,12.24),'speaker_1')

    def test_overlap_low_confidence_and_unseen_tail_are_unresolved(self):
        timeline=SpeakerTimeline(.08)
        timeline.update(np.array([[.95,.02]]*50+[[.92,.9]]*10+[[.52,.48]]*10))
        self.assertIsNone(timeline.label_interval(4,4.8))
        self.assertIsNone(timeline.label_interval(4.8,5.6))
        self.assertIsNone(timeline.label_interval(5.6,6.6))
        self.assertEqual(timeline.label_interval(0,1),'speaker_0')

    def test_sustained_change_is_preserved_and_can_relabel_earlier_short_voice(self):
        timeline=SpeakerTimeline(.08)
        probs=np.array([[.95,.02]]*50+[[.02,.95]]*10)
        timeline.update(probs)
        self.assertIsNone(timeline.label_interval(4,4.8))
        timeline.update(np.concatenate([probs,np.array([[.95,.02]]*50+[[.02,.95]]*50)]))
        self.assertEqual(timeline.label_interval(4,4.8),'speaker_1')
        self.assertEqual(timeline.tail()[0],'speaker_1')
        self.assertIsNotNone(timeline.tail()[1])

    def test_matching_known_voices_bridge_short_confidence_holes_after_lookahead(self):
        timeline=SpeakerTimeline(.08)
        first=np.array([[.95,.02]]*50+[[.56,.44]]*2+[[.72,.1]]*2+[[.56,.44]]*2)
        timeline.update(first)
        self.assertIsNone(timeline.label_interval(4,4.48))
        timeline.update(np.concatenate([first,np.array([[.95,.02]]*50)]))
        self.assertEqual(timeline.label_interval(4,4.48),'speaker_0')

    def test_bridging_never_crosses_overlap_or_a_competing_short_voice(self):
        for middle in ([[.9,.88]]*4,[[.2,.8]]*2):
            timeline=SpeakerTimeline(.08)
            timeline.update(np.array([[.95,.02]]*50+middle+[[.95,.02]]*50))
            self.assertIsNone(timeline.label_interval(4,4+len(middle)*.08))
            if middle[0][1] > middle[0][0]:
                self.assertIn('speaker_1',timeline.candidates_in_interval(4,4+len(middle)*.08))
            else:
                self.assertTrue(timeline.has_overlap(4,4+len(middle)*.08))

    def test_long_holes_and_real_turn_boundaries_remain_unresolved(self):
        for middle,right in (([[.56,.44]]*20,[[.95,.02]]*50),
                             ([[.56,.44]]*4,[[.02,.95]]*50)):
            timeline=SpeakerTimeline(.08)
            timeline.update(np.array([[.95,.02]]*50+middle+right))
            self.assertIsNone(timeline.label_interval(4,4+len(middle)*.08))

    def test_overlap_reason_survives_grouping(self):
        timeline=SpeakerTimeline(.08)
        timeline.update(np.array([[.95,.02]]*50+[[.9,.88]]*4+[[.95,.02]]*50))
        self.assertTrue(timeline.has_overlap(4,4.32))
        self.assertFalse(timeline.has_overlap(0,1))
        words=[dict(start=0,end=.1,word='甲',speaker=None),
               dict(start=.1,end=.2,word='乙',speaker=None,speaker_uncertain_reason='overlap')]
        self.assertEqual(group_words(words)[1]['speaker_uncertain_reason'],'overlap')
        self.assertEqual(len(group_words(words)),2)

    def test_strong_word_inside_short_run_survives_weak_edges(self):
        timeline = SpeakerTimeline(.01)
        probs = np.array([[.95, .01]]*400 + [[.1, .01]]*20 +
                         [[.68, .01]]*8 + [[.998, .01]]*16 +
                         [[.68, .01]]*8 + [[.1, .01]]*20)
        timeline.update(probs)
        self.assertEqual(timeline.label_interval(4.28, 4.44), 'speaker_0')
        # Local scores cannot repair a word lying in an unsupported gap.
        self.assertIsNone(timeline.label_interval(4.02, 4.18))
        self.assertEqual(timeline.tail(), (None, None))

    def test_short_known_second_voice_uses_its_own_evidence(self):
        timeline = SpeakerTimeline(.01)
        timeline.update(np.array([[.95, .01]]*400 + [[.01, .95]]*400 +
                                 [[.95, .01]]*400 + [[.01, .68]]*8 +
                                 [[.01, .98]]*16 + [[.01, .68]]*8))
        self.assertEqual(timeline.label_interval(12.08, 12.24), 'speaker_1')
        # A word label does not promote a short run to a sustained ASR turn.
        self.assertIsNone(timeline.tail()[1])

    def test_word_local_evidence_does_not_promote_an_unseen_voice(self):
        timeline = SpeakerTimeline(.01)
        first = np.array([[.95, .01]]*400 + [[.01, .68]]*8 +
                          [[.01, .998]]*16 + [[.01, .68]]*8)
        timeline.update(first)
        self.assertIsNone(timeline.label_interval(4.08, 4.24))
        timeline.update(np.concatenate([first, np.array([[.95, .01]]*100 + [[.01, .95]]*400)]))
        self.assertEqual(timeline.label_interval(4.08, 4.24), 'speaker_1')

    def test_high_score_flicker_and_overlap_are_not_recovered(self):
        for middle in ([[.01, .998]]*10, [[.998, .92]]*32):
            timeline = SpeakerTimeline(.01)
            timeline.update(np.array([[.95, .01]]*400 + [[.01, .95]]*400 +
                                     [[.95, .01]]*400 + middle + [[.95, .01]]*400))
            self.assertIsNone(timeline.label_interval(12, 12+len(middle)*.01))

    def test_candidates_are_local_to_word_not_whole_unknown_run(self):
        timeline = SpeakerTimeline(.01)
        timeline.update(np.array([[.95, .01]]*400 + [[.55, .01]]*40 +
                                 [[.01, .55]]*40 + [[.95, .01]]*400))
        self.assertEqual(timeline.candidates_in_interval(4, 4.4), ['speaker_0'])
        self.assertEqual(timeline.candidates_in_interval(4.4, 4.8), ['speaker_1'])
        self.assertEqual(timeline.candidates_in_interval(4, 4.8), ['speaker_0', 'speaker_1'])


if __name__=='__main__': unittest.main()
