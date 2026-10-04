import unittest
from nemotron3_diarize import normalize_segments


class NemotronFormatTests(unittest.TestCase):
    def test_eight_speakers_absolute_seconds_and_overlap(self):
        rows = [f"{1200+i}.01 {1202+i}.02 speaker_{i}" for i in reversed(range(8))]
        segments = normalize_segments(rows, 10430.464)
        self.assertEqual(len({s['speaker'] for s in segments}), 8)
        self.assertEqual(segments[0]['start'], 1200.01)
        self.assertGreater(segments[0]['end'], segments[1]['start'])
        self.assertNotIn('confidence', segments[0])

    def test_last_frame_clipped(self):
        self.assertEqual(normalize_segments(['9.9 10.01 speaker_0'], 10)[0]['end'], 10)

    def test_no_speech(self):
        self.assertEqual(normalize_segments([], 10), [])

    def test_invalid_data_rejected(self):
        for row in ['0 1 speaker_8', 'nan 2 speaker_0', '-1 2 speaker_0',
                    '2 1 speaker_0', '0 1000 speaker_0', '0 1 person',
                    '0 1 speaker_0 extra']:
            with self.subTest(row=row), self.assertRaises(ValueError):
                normalize_segments([row], 10)


if __name__ == '__main__':
    unittest.main()
