"""Conservative word labels: short, unsupported channels remain unresolved."""

from array import array
import math


def choose_speaker(probabilities, all_probabilities, resolution, minimum_seconds=3.0):
    if not len(probabilities):
        return None
    average = probabilities.mean(0)
    index = int(average.argmax())
    # Enough high-confidence activity is required before publishing a new ID.
    evidence = float((all_probabilities[:, index] >= .65).sum()) * resolution
    if float(average[index]) < .65 or evidence < minimum_seconds:
        return None
    return f"speaker_{index}"


def group_words(words):
    segments = []
    for word in words:
        if (segments and segments[-1]["speaker"] == word.get("speaker")
                and word["start"] - segments[-1]["end"] < .8
                and segments[-1].get("speaker_uncertain_reason") == word.get("speaker_uncertain_reason")):
            segments[-1]["text"] += word["word"]
            segments[-1]["end"] = word["end"]
            if word.get("speaker_candidates"):
                segments[-1]["speaker_candidates"] = sorted(set(segments[-1].get("speaker_candidates", [])) | set(word["speaker_candidates"]))
        else:
            segments.append(dict(start=word["start"], end=word["end"],
                                 text=word["word"], speaker=word.get("speaker")))
            if word.get("speaker_uncertain_reason"):
                segments[-1]["speaker_uncertain_reason"] = word["speaker_uncertain_reason"]
            if word.get("speaker_candidates"):
                segments[-1]["speaker_candidates"] = list(word["speaker_candidates"])
    return segments


class SpeakerTimeline:
    """Stable frame runs, with explicit uncertainty for overlap/weak evidence.

    A known speaker's strong short interjection may be labelled without forcing
    an ASR cut. Newly discovered voices need cumulative evidence before IDs are
    published. No unknown interval is silently assigned to the previous voice.
    """
    def __init__(self, resolution, minimum_evidence=3.0, minimum_turn=.5):
        self.resolution = resolution
        self.minimum_evidence = minimum_evidence
        self.minimum_turn = minimum_turn
        self.runs = []
        self.starts = []
        self.evidence = {}
        self.frames = 0
        # Compact raw scores support word-local decisions without a run's weak
        # edge frames vetoing a strong syllable in its interior.
        self.scores = array('f')
        self.channels = 0

    def update(self, probabilities):
        for row in probabilities[self.frames:]:
            values = [float(x) for x in row]
            if not self.channels:
                self.channels = len(values)
            if len(values) != self.channels:
                raise ValueError('Speaker channel count changed within a session')
            self.scores.extend(values)
            index = max(range(len(values)), key=values.__getitem__)
            ranked = sorted(values, reverse=True)
            overlap = len(ranked) > 1 and ranked[1] >= .65
            valid = values[index] >= .65 and (len(ranked) < 2 or ranked[0]-ranked[1] >= .15) and not overlap
            label = index if valid else None
            if valid:
                self.evidence[index] = self.evidence.get(index, 0) + self.resolution
            if self.runs and self.runs[-1]['label'] == label and self.runs[-1]['overlap'] == overlap:
                self.runs[-1]['end'] += 1
                self.runs[-1]['confidence'] = min(self.runs[-1]['confidence'], values[index])
                if values[index] >= .5:
                    self.runs[-1]['candidates'].add(index)
            else:
                self.starts.append(self.frames)
                self.runs.append(dict(start=self.frames, end=self.frames+1, label=label,
                                      confidence=values[index], overlap=overlap,
                                      candidates={index} if values[index] >= .5 else set()))
            self.frames += 1

    def _label(self, run):
        label = run['label']
        if label is None or self.evidence.get(label, 0) + 1e-6 < self.minimum_evidence:
            return None
        duration = (run['end']-run['start'])*self.resolution
        if duration + 1e-6 >= self.minimum_turn or (duration + 1e-6 >= .24 and run['confidence'] >= .9):
            return f'speaker_{label}'
        return None

    def _context_label(self, index):
        """Bridge a bounded confidence hole only between matching known voices.

        Do not lower identity thresholds or bridge overlap/competing short voices.
        A right anchor is required, so a new trailing voice stays provisional.
        """
        run = self.runs[index]
        direct = self._label(run)
        if direct is not None or run['overlap']:
            return direct
        left, right = index-1, index+1
        while left >= 0 and self._label(self.runs[left]) is None:
            if (run['end']-self.runs[left]['start'])*self.resolution > 1.5:
                return None
            left -= 1
        while right < len(self.runs) and self._label(self.runs[right]) is None:
            if (self.runs[right]['end']-run['start'])*self.resolution > 1.5:
                return None
            right += 1
        if left < 0 or right >= len(self.runs):
            return None
        label = self._label(self.runs[left])
        if label != self._label(self.runs[right]):
            return None
        middle = self.runs[left+1:right]
        if (middle[-1]['end']-middle[0]['start'])*self.resolution > 1.5:
            return None
        candidate = int(label.split('_')[1])
        if any(r['overlap'] or r['candidates'] - {candidate} for r in middle):
            return None
        return label

    def candidates_in_interval(self, begin, end):
        candidates = set()
        # A candidate elsewhere in a long unresolved run is not evidence for
        # this word. Export only channels active in its own frames.
        for scores, weight in self._interval_scores(begin, end):
            candidates.update(i for i, score in enumerate(scores) if score >= .5)
        return [f'speaker_{candidate}' for candidate in sorted(candidates)]

    def _interval_scores(self, begin, end):
        first = max(0, math.floor(begin/self.resolution))
        last = min(self.frames, math.ceil(end/self.resolution))
        for frame in range(first, last):
            weight = min(end, (frame+1)*self.resolution)-max(begin, frame*self.resolution)
            if weight > 1e-9:
                offset = frame*self.channels
                yield self.scores[offset:offset+self.channels], weight

    def _local_word_label(self, begin, end):
        """Recover strong words in short runs of an already established voice.

        Require local score, margin, coverage and a supporting 240 ms run.
        This does not promote an unseen voice, a brief flicker, or overlap.
        Turn detection keeps its existing sustained-run rules.
        """
        if end <= begin or self.has_overlap(begin, end):
            return None
        totals = [0.0]*self.channels
        strong = [0.0]*self.channels
        covered = 0.0
        for scores, weight in self._interval_scores(begin, end):
            covered += weight
            order = sorted(range(self.channels), key=scores.__getitem__, reverse=True)
            top = order[0]
            for channel, score in enumerate(scores):
                totals[channel] += score*weight
            if scores[top] >= .65 and (len(order) == 1 or scores[top]-scores[order[1]] >= .15):
                strong[top] += weight
        if not covered or covered < (end-begin)*.8:
            return None
        ranked = sorted(range(self.channels), key=totals.__getitem__, reverse=True)
        candidate = ranked[0]
        second = totals[ranked[1]] if len(ranked) > 1 else 0.0
        if (totals[candidate]/covered < .65 or (totals[candidate]-second)/covered < .3
                or strong[candidate] < covered*.7
                or self.evidence.get(candidate, 0)+1e-6 < self.minimum_evidence):
            return None
        from bisect import bisect_right
        index = max(0, bisect_right(self.starts, begin/self.resolution)-1)
        supported = 0.0
        for i in range(index, len(self.runs)):
            run = self.runs[i]
            left, right = run['start']*self.resolution, run['end']*self.resolution
            if left >= end:
                break
            if run['label'] == candidate and right-left+1e-6 >= .24:
                supported += max(0.0, min(end, right)-max(begin, left))
        return f'speaker_{candidate}' if supported >= covered*.7 else None

    def has_overlap(self, begin, end):
        from bisect import bisect_right
        index = max(0, bisect_right(self.starts, begin/self.resolution)-1)
        for i in range(index, len(self.runs)):
            run = self.runs[i]
            if run['start']*self.resolution >= end:
                break
            if run['end']*self.resolution > begin and run['overlap']:
                return True
        return False

    def tail(self):
        if not self.runs:
            return None, None
        run = self.runs[-1]
        label = self._label(run)
        # Strong brief interjections keep their identity but never force a cut.
        sustained = (run['end']-run['start'])*self.resolution >= self.minimum_turn
        turn = (label, round(run['start']*self.resolution, 4)) if label and sustained else None
        return label, turn

    def label_interval(self, begin, end):
        from bisect import bisect_right
        index = max(0, bisect_right(self.starts, begin/self.resolution)-1)
        totals = {}
        covered = 0.0
        for i in range(index, len(self.runs)):
            run = self.runs[i]
            left, right = run['start']*self.resolution, run['end']*self.resolution
            if left >= end:
                break
            overlap = max(0.0, min(end, right)-max(begin, left))
            covered += overlap
            label = self._context_label(i)
            totals[label] = totals.get(label, 0.0) + overlap
        if not totals or covered < max(0, end-begin)*.8:
            return None
        label = max(totals, key=totals.get)
        if label is not None and totals[label] >= covered*.7:
            return label
        return self._local_word_label(begin, end)
