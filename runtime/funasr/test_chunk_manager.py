"""Unit tests for the experimental audio-input chunk planner."""

import unittest

from chunk_manager import Interval, plan_chunks, _stable_switches


class ChunkManagerTests(unittest.TestCase):
    def test_half_second_threshold_keeps_short_real_turn(self):
        turns = [Interval(0, 4, "speaker_0"), Interval(4.2, 4.8, "speaker_1")]
        switches = _stable_switches(turns)
        self.assertEqual(len(switches), 1)
        self.assertAlmostEqual(switches[0].time, 4.1)
        self.assertEqual(_stable_switches([turns[0], Interval(4.2, 4.69, "speaker_1")]), [])

    def test_nemotron_fragmented_previous_turn_no_false_early_midpoint(self):
        turns = [Interval(1032.43, 1037.62, "speaker_0"),
                 Interval(1038.35, 1039.18, "speaker_0"),
                 Interval(1039.70, 1041.67, "speaker_0"),
                 Interval(1042.26, 1043.91, "speaker_0"),
                 Interval(1043.48, 1050.17, "speaker_2")]
        # Retained short A segments overlap B by >0.3s; existing overlap rule
        # suppresses this candidate instead of inventing the 1040.55 midpoint.
        self.assertEqual(_stable_switches(turns), [])

    def test_short_overlap_does_not_split_sustained_speaker(self):
        vad = [Interval(i * 2.0, i * 2.0 + 1.8) for i in range(15)]
        turns = [Interval(0, 30, "speaker_0"), Interval(12, 12.4, "speaker_1")]
        chunks = plan_chunks(vad, turns, 30)
        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].dominant_speaker, "speaker_0")

    def test_sustained_switch_splits_even_inside_vad(self):
        vad = [Interval(0, 30)]
        turns = [Interval(0, 14, "speaker_0"), Interval(14.5, 30, "speaker_3")]
        chunks = plan_chunks(vad, turns, 30)
        self.assertEqual(len(chunks), 2)
        self.assertAlmostEqual(chunks[0].core_end, 14.25)
        self.assertEqual(chunks[0].cut_reason, "sustained_speaker_change")
        self.assertEqual(chunks[1].core_start, chunks[0].core_end)

    def test_multiple_switches_in_final_remainder(self):
        vad = [Interval(0, 25)]
        turns = [Interval(0, 7, "speaker_0"), Interval(7.4, 15, "speaker_3"),
                 Interval(15.4, 25, "speaker_0")]
        chunks = plan_chunks(vad, turns, 25)
        self.assertEqual(len(chunks), 3)
        self.assertEqual(chunks[-1].core_end, 25)

    def test_forced_cut_uses_energy_callback_and_overlap_padding(self):
        chunks = plan_chunks([Interval(0, 65)], [Interval(0, 65, "speaker_0")],
                             65, quietest_cut=lambda lower, upper: upper - 1)
        self.assertEqual(chunks[0].core_end, 29)
        self.assertEqual(chunks[0].cut_reason, "forced_low_energy")
        self.assertAlmostEqual(chunks[0].input_end, 29.8)
        self.assertAlmostEqual(chunks[1].input_start, 28.2)
        self.assertEqual(chunks[-1].core_end, 65)


if __name__ == "__main__":
    unittest.main()
