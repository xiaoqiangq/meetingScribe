"""Checks for the Qwen/Scriberr JSON boundary without loading model weights."""

import unittest
import json
import tempfile
from pathlib import Path

from qwen3_transcribe import convert_qwen_result, _save_chunk_outputs, _aligned_words


class QwenConversionTests(unittest.TestCase):
    def test_repeated_ok_keeps_punctuation_on_one_actual_model_interval(self):
        text = "对，OK，OK。然后"
        stamps = [[0, 100], [100, 400], [400, 500], [500, 600]]
        words = _aligned_words(text, stamps, None, 0, 1, ["对", "OKOK", "然", "后"])
        self.assertIsNotNone(words)
        self.assertEqual("".join(w["word"] for w in words), text)
        self.assertEqual(words[1], {"word": "OK，OK。", "start": 0.1, "end": 0.4, "score": 0.0})

    def test_hyphenated_term_uses_two_actual_model_units(self):
        words = _aligned_words("服用GLP-1有效。", [[i*100, (i+1)*100] for i in range(6)],
                               None, 0, 1, ["服", "用", "GLP", "1", "有", "效"])
        self.assertEqual([w["word"] for w in words], ["服", "用", "GLP-", "1", "有", "效。"])

    def test_apostrophe_unicode_letters_and_source_spaces_survive(self):
        text = "嗯，don't café！"
        words = _aligned_words(text, [[0,100],[100,200],[200,300]], None, 0, 1,
                               ["嗯", "don't", "café"])
        self.assertEqual("".join(w["word"] for w in words), text)

    def test_rejects_wrong_labels_even_when_counts_match(self):
        self.assertIsNone(_aligned_words("你好。", [[0,100],[100,200]], None, 0, 1, ["你", "坏"]))

    def test_rejects_missing_model_unit_instead_of_silently_dropping_text(self):
        self.assertIsNone(_aligned_words("你好。", [[0,100]], None, 0, 1, ["你"]))

    def test_returned_units_preserve_leading_and_trailing_punctuation(self):
        text = "“你好！”"
        words = _aligned_words(text, [[0,100],[100,200]], None, 0, 1, ["你", "好"])
        self.assertEqual("".join(w["word"] for w in words), text)

    def test_raw_chunk_evidence_preserves_prefilter_and_selected_text(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "qwen-chunk-outputs.json"
            records = [{"index": 56, "raw_text": "范畴。现在",
                        "selected_text": "范畴。现", "status": "core_filtered",
                        "aligned_words_global_s": [{"word": "现", "start": 1057.54, "end": 1057.62}]}]
            _save_chunk_outputs(path, records)
            records.append({"index": 57, "raw_text": "现在我就跟你讲，", "status": "recognized"})
            _save_chunk_outputs(path, records)
            saved = json.loads(path.read_text())
            self.assertEqual(saved["chunks"], records)
            self.assertEqual(saved["schema_version"], 1)

    def test_keeps_speaker_text_and_character_times(self):
        item = {
            "text": "你好，世界。",
            "sentence_info": [{
                "text": "你好，世界。", "start": 1000, "end": 3000, "spk": 2,
                "timestamp": [[1000, 1200], [1200, 1400], [1500, 1700], [1700, 1900]],
            }],
        }
        result = convert_qwen_result(item, True)
        self.assertEqual(result["segments"][0]["speaker"], "speaker_2")
        self.assertEqual("".join(w["word"] for w in result["word_segments"]), item["text"])
        self.assertEqual(result["word_segments"][-1]["end"], 1.9)

    def test_hiding_speakers_does_not_drop_text(self):
        item = {
            "text": "你好。",
            "sentence_info": [{
                "text": "你好。", "start": 1000, "end": 2000, "spk": 0,
                "timestamp": [[1000, 1200], [1200, 1400]],
            }],
        }
        result = convert_qwen_result(item, False)
        self.assertNotIn("speaker", result["segments"][0])
        self.assertNotIn("speaker", result["word_segments"][0])

    def test_rejects_partial_alignment_instead_of_publishing_wrong_words(self):
        item = {
            "text": "你好。再见。",
            "sentence_info": [
                {"text": "你好。", "start": 1000, "end": 2000, "spk": 0,
                 "timestamp": [[1000, 1200], [1200, 1400]]},
                {"text": "再见。", "start": 2100, "end": 3000, "spk": 0,
                 "timestamp": [[2100, 2300]]},
            ],
        }
        result = convert_qwen_result(item, True)
        self.assertEqual(result["word_segments"], [])
        self.assertEqual(len(result["segments"]), 2)
        self.assertEqual(result["metadata"]["alignment"], "VAD segments only")

    def test_ascii_terms_are_one_aligned_unit_each(self):
        item = {
            "text": "你这PPT是AI做的吧？",
            "sentence_info": [{
                "text": "你这PPT是AI做的吧？", "start": 1000, "end": 3000, "spk": 0,
                "timestamp": [[1000 + i * 200, 1120 + i * 200] for i in range(8)],
            }],
        }
        result = convert_qwen_result(item, True)
        self.assertEqual(len(result["word_segments"]), 8)
        self.assertEqual("".join(w["word"] for w in result["word_segments"]), item["text"])

    def test_hyphenated_ascii_term_is_one_aligned_unit(self):
        item = {
            "text": "服用GLP-1有效。",
            "sentence_info": [{
                "text": "服用GLP-1有效。", "start": 1000, "end": 3000, "spk": 0,
                "timestamp": [[1000 + i * 200, 1120 + i * 200] for i in range(5)],
            }],
        }
        result = convert_qwen_result(item, False)
        self.assertEqual(result["metadata"]["alignment"], "character")
        self.assertEqual(result["word_segments"][2]["word"], "GLP-1")

    def test_zero_length_final_timestamp_gets_a_clickable_interval(self):
        item = {
            "text": "好。",
            "sentence_info": [{
                "text": "好。", "start": 1000, "end": 2000, "spk": 0,
                "timestamp": [[2000, 2000]],
            }],
        }
        result = convert_qwen_result(item, True)
        self.assertGreater(result["word_segments"][0]["end"],
                           result["word_segments"][0]["start"])


if __name__ == "__main__":
    unittest.main()
