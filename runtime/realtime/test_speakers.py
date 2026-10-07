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


if __name__=='__main__': unittest.main()
