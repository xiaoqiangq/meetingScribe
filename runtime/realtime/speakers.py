"""Conservative word labels: short, unsupported channels remain unresolved."""


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
                and word["start"] - segments[-1]["end"] < .8):
            segments[-1]["text"] += word["word"]
            segments[-1]["end"] = word["end"]
        else:
            segments.append(dict(start=word["start"], end=word["end"],
                                 text=word["word"], speaker=word.get("speaker")))
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

    def update(self, probabilities):
        for row in probabilities[self.frames:]:
            values = [float(x) for x in row]
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
            else:
                self.starts.append(self.frames)
                self.runs.append(dict(start=self.frames, end=self.frames+1, label=label,
                                      confidence=values[index], overlap=overlap))
            self.frames += 1

    def _label(self, run):
        label = run['label']
        if label is None or self.evidence.get(label, 0) + 1e-6 < self.minimum_evidence:
            return None
        duration = (run['end']-run['start'])*self.resolution
        if duration + 1e-6 >= self.minimum_turn or (duration + 1e-6 >= .24 and run['confidence'] >= .9):
            return f'speaker_{label}'
        return None

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
            label = self._label(run)
            totals[label] = totals.get(label, 0.0) + overlap
        if not totals or covered < max(0, end-begin)*.8:
            return None
        label = max(totals, key=totals.get)
        return label if label is not None and totals[label] >= covered*.7 else None
