#!/usr/bin/env python3
"""Isolated Nemotron-native enrollment experiment. Never writes production results."""
import argparse
import hashlib
import json
import math
import time
from pathlib import Path

CONFIG = dict(spkcache_len=264, fifo_len=40, chunk_len=340,
              chunk_right_context=40, spkcache_update_period=300)
MODEL_ID = 'nvidia/Nemotron-3-Diarization'


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1048576), b''):
            h.update(block)
    return h.hexdigest()


def save_json(path, value):
    with Path(path).open('x', encoding='utf-8') as f:
        json.dump(value, f, ensure_ascii=False, indent=2)


def load_model(path, device):
    import torch
    from nemo.collections.asr.models import SortformerEncLabelModel
    model = SortformerEncLabelModel.restore_from(str(path), map_location='cpu', strict=True)
    model.eval().to(device)
    for key, value in CONFIG.items():
        setattr(model.sortformer_modules, key, value)
    model._check_streaming_parameters()
    if (not model.streaming_mode or model.async_streaming
            or model.sortformer_modules.n_spk != 8 or not model.high_resolution):
        raise ValueError('This trial requires synchronous streaming, 8 channels, high-resolution Nemotron3')
    torch.set_num_threads(4)
    return model


def read_audio(path, model):
    import numpy as np
    import soundfile as sf
    import torch
    audio, sr = sf.read(path, dtype='float32')
    if sr != 16000 or audio.ndim != 1 or len(audio) < 16000:
        raise ValueError(f'Expected >=1 second, 16kHz mono: {path}')
    if not np.isfinite(audio).all() or np.sqrt(np.mean(audio ** 2)) < 1e-4:
        raise ValueError(f'Invalid or effectively silent audio: {path}')
    tensor = torch.from_numpy(audio).to(model.device)[None, :]
    length = torch.tensor([len(audio)], device=model.device, dtype=torch.long)
    return tensor, length


def preencode(path, model, seconds):
    import torch
    audio, length = read_audio(path, model)
    # Use the same model preprocessing as meeting inference; store frames, not pooled voiceprints.
    with torch.inference_mode():
        features, feature_lengths = model.process_signal(audio, length)
        features = features[:, :, :int(feature_lengths.max())]
        embeds, embed_lengths = model._call_pre_encode(features.transpose(1, 2), feature_lengths)
    embeds = embeds[:, :int(embed_lengths[0])]
    count = min(embeds.shape[1], math.floor(seconds / .08))
    if count < 8:
        raise ValueError('Too few reference frames')
    start = (embeds.shape[1] - count) // 2
    return embeds[0, start:start + count].detach().float().cpu().clone()


def build(args, model):
    import torch
    if args.library.exists():
        raise ValueError('Use a new library directory; existing libraries are never overwritten')
    plan = json.loads(args.plan.read_text())
    references = [s for s in plan['samples'] if s['role'] == 'reference']
    persons = {}
    for s in references:
        persons.setdefault(s['person_id'], dict(person_id=s['person_id'], name=s['name'], samples=[]))['samples'].append(s)
    if not persons or len(persons) >= 8:
        raise ValueError('Need 1-7 known people with room for an unknown channel')
    metadata, tensors = [], []
    for person in persons.values():
        blocks, source_records = [], []
        for s in person['samples']:
            source = args.samples / s['file']
            if sha256(source) != s['audio_sha256']:
                raise ValueError(f'Reference hash mismatch: {source}')
            block = preencode(source, model, args.reference_seconds)
            blocks.append(block)
            source_records.append(dict(file=s['file'], sha256=s['audio_sha256'], frames=len(block)))
        tensor = torch.cat(blocks)
        if args.silence_frames:
            if not model.sortformer_modules.use_learnable_sil_emb:
                raise ValueError('Checkpoint has no learned silence delimiter')
            silence = model.sortformer_modules.learnable_sil_emb.detach().float().cpu()
            tensor = torch.cat([tensor, silence.reshape(1, -1).repeat(args.silence_frames, 1)])
        tensors.append(tensor)
        metadata.append(dict(person_id=person['person_id'], name=person['name'], frames=len(tensor),
                             silence_frames=args.silence_frames, source_records=source_records))
    if sum(len(t) for t in tensors) > CONFIG['spkcache_len']:
        raise ValueError('Reference bank exceeds cache capacity; reduce reference_seconds/selected people')
    args.library.mkdir(mode=0o700)
    bank = {p['person_id']: t for p, t in zip(metadata, tensors)}
    torch.save(bank, args.library / 'native_frames.pt')
    (args.library / 'native_frames.pt').chmod(0o600)
    save_json(args.library / 'library.json', dict(model=MODEL_ID, model_sha256=sha256(args.model),
              bank_sha256=sha256(args.library / 'native_frames.pt'), persons=metadata,
              feature_type='Nemotron pre-encoder acoustic frames, not calibrated speaker embeddings',
              reference_seconds=args.reference_seconds, source_job=plan.get('source_job'),
              source_audio_sha256=plan.get('source_audio_sha256'), config=CONFIG))
    print(json.dumps(dict(library=str(args.library), persons=metadata), ensure_ascii=False), flush=True)


def load_bank(args, model):
    import torch
    metadata = json.loads((args.library / 'library.json').read_text())
    if metadata['model_sha256'] != sha256(args.model):
        raise ValueError('Checkpoint differs from reference feature checkpoint')
    path = args.library / 'native_frames.pt'
    if metadata['bank_sha256'] != sha256(path):
        raise ValueError('Feature bank hash mismatch')
    bank = torch.load(path, map_location='cpu', weights_only=True)
    for person in metadata['persons']:
        t = bank[person['person_id']]
        if (t.ndim != 2 or len(t) != person['frames'] or t.shape[1] != model.sortformer_modules.fc_d_model
                or not torch.isfinite(t).all()):
            raise ValueError('Invalid native feature bank')
    return metadata, bank


def selected_people(metadata, names):
    people = metadata['persons']
    if names is not None:
        requested = names.split(',')
        by_name = {p['name']: p for p in people}
        if len(set(requested)) != len(requested) or any(n not in by_name for n in requested):
            raise ValueError(f'Unknown or duplicate selection: {requested}')
        people = [by_name[n] for n in requested]
    if not people or len(people) >= 8:
        raise ValueError('Select 1-7 people')
    return people


def anchors_to_mapping(anchor_scores, minimum, margin):
    # Check what the network actually predicts for each reference; never assume one-hot cache labels bind identity.
    mapping, details = {}, []
    valid = True
    for person, scores in anchor_scores:
        order = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)
        channel = order[0]
        gap = scores[channel] - scores[order[1]]
        accepted = scores[channel] >= minimum and gap >= margin and channel not in mapping
        valid = valid and accepted
        details.append(dict(name=person['name'], channel=channel, score=scores[channel], gap=gap, valid=accepted))
        mapping[channel] = person['name']
    return (mapping if valid else {}), details, valid


def classify(scores, mapping, anchor_valid, minimum, margin):
    order = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)
    ch = order[0]
    gap = scores[ch] - scores[order[1]]
    if not anchor_valid or scores[ch] < minimum or gap < margin:
        return dict(status='needs_review', name=None, channel=ch, score=scores[ch], gap=gap)
    if ch in mapping:
        return dict(status='known_candidate', name=mapping[ch], channel=ch, score=scores[ch], gap=gap)
    return dict(status='unknown_candidate', name=None, channel=ch, score=scores[ch], gap=gap)


def run_audio(args, model, path, people, bank, mode='seeded'):
    import torch
    modules = model.sortformer_modules
    original_init, original_infer = modules.init_streaming_state, model.forward_infer
    anchor_scores = []
    seed = torch.cat([bank[p['person_id']] for p in people]).to(model.device)[None]
    if seed.shape[1] > modules.spkcache_len:
        raise ValueError('Selected bank exceeds cache capacity')
    first = True
    injected = 0

    def initialize(*a, **kw):
        nonlocal injected
        state = original_init(*a, **kw)
        if kw.get('batch_size', 1) != 1 or kw.get('async_streaming', False):
            raise ValueError('Enrollment experiment supports synchronous batch_size=1 only')
        if mode == 'seeded':
            state.spkcache = seed.clone()
            # This state flag/labels are not supplied to Transformer; let normal prediction/update run.
            state.spkcache_preds = None
            state.spkcache_compressed = False
            injected += 1
        return state

    def infer(*a, **kw):
        nonlocal first
        output = original_infer(*a, **kw)
        preds = output[0] if isinstance(output, tuple) else output
        if first and mode == 'seeded':
            factor = model.upsample_factor
            offset = 0
            for p in people:
                count = bank[p['person_id']].shape[0] * factor
                speech_count = count - p.get('silence_frames', 0) * factor
                scores = preds[0, offset:offset + speech_count].float().mean(0).cpu().tolist()
                anchor_scores.append((p, scores))
                offset += count
            first = False
        return output

    audio, length = read_audio(path, model)
    if model.device.type == 'cuda':
        torch.cuda.synchronize()
    begin = time.perf_counter()
    try:
        modules.init_streaming_state = initialize
        model.forward_infer = infer
        with torch.inference_mode():
            probs = model.forward(audio_signal=audio, audio_signal_length=length)[0].detach().float()
        if model.device.type == 'cuda':
            torch.cuda.synchronize()
    finally:
        modules.init_streaming_state = original_init
        model.forward_infer = original_infer
    elapsed = time.perf_counter() - begin
    if mode == 'seeded' and injected != 1:
        raise ValueError(f'Expected one cache initialization, got {injected}')
    duration = int(length[0]) / 16000
    probs = probs[:math.ceil(duration / (model.output_subsampling_factor * .01))]
    if getattr(args, 'probabilities', None):
        import numpy as np
        with args.probabilities.open('xb') as stream:
            np.savez_compressed(stream, probabilities=probs.cpu().numpy(),
                                stride_s=model.output_subsampling_factor * .01, duration_s=duration)
    scores = probs.mean(0).cpu().tolist()
    mapping, anchor_details, valid = anchors_to_mapping(anchor_scores, args.minimum, args.margin)
    result = dict(audio=str(path), mode=mode, duration_s=duration, inference_s=elapsed,
                  rtfx=duration / elapsed, scores=scores, anchors=anchor_details,
                  anchor_mapping_valid=valid, channel_names={str(k): v for k, v in mapping.items()},
                  selected=[p['name'] for p in people], **classify(scores, mapping, valid, args.minimum, args.margin))
    # Raw model probabilities are not calibrated identity probabilities. Preserve overlap and absolute query time.
    stride = model.output_subsampling_factor * .01
    intervals = []
    mask = (probs >= args.minimum).cpu().tolist()
    for ch in range(8):
        start = None
        for i in range(len(mask) + 1):
            active = i < len(mask) and mask[i][ch]
            if active and start is None:
                start = i
            if not active and start is not None:
                intervals.append(dict(start=round(start * stride, 3), end=round(min(i * stride, duration), 3),
                                      speaker=f'speaker_{ch}', candidate_name=mapping.get(ch) if valid else None))
                start = None
    result['segments'] = sorted(intervals, key=lambda s: (s['start'], s['end'], s['speaker']))
    if getattr(args, 'windows', None):
        windows = json.loads(args.windows.read_text())
        checks = []
        for window in windows:
            start, end = window['start'] + .35, window['end'] - .35
            if not 0 <= start < end <= duration:
                raise ValueError('Invalid continuity label window')
            values = probs[math.ceil(start / stride):math.floor(end / stride)].mean(0).cpu().tolist()
            check = dict(window, **classify(values, mapping, valid, args.minimum, args.margin))
            check['correct_known'] = check['name'] == window['expected_name']
            checks.append(check)
        result['labelled_windows'] = checks
        result['continuity_summary'] = dict(count=len(checks), correct_known=sum(w['correct_known'] for w in checks),
            false_known=sum(w['name'] is not None and not w['correct_known'] for w in checks),
            needs_review=sum(w['status'] == 'needs_review' for w in checks))
    return result


def evaluate(args, model, metadata, bank):
    plan = json.loads(args.plan.read_text())
    tests = [s for s in plan['samples'] if s['role'] == 'validation']
    people = selected_people(metadata, args.people)
    if any(s['person_id'] not in {p['person_id'] for p in people} for s in tests):
        raise ValueError('Evaluation requires all labelled identities selected')
    rows = []
    for s in tests:
        path = args.samples / s['file']
        if sha256(path) != s['audio_sha256']:
            raise ValueError('Validation audio hash mismatch')
        for scenario, selected, mode in [
            ('all_present', people, 'seeded'),
            ('reverse_selection_order', list(reversed(people)), 'seeded'),
            ('held_out_identity', [p for p in people if p['person_id'] != s['person_id']], 'seeded'),
            ('unseeded_baseline', people, 'baseline'),
        ]:
            row = run_audio(args, model, path, selected, bank, mode)
            row.update(scenario=scenario, expected_name=s['name'], sample=s['file'])
            rows.append(row)
            print(json.dumps({k: row[k] for k in ('scenario', 'sample', 'expected_name', 'status', 'name', 'inference_s', 'anchors')}, ensure_ascii=False), flush=True)
    summary = {}
    for scenario in sorted({r['scenario'] for r in rows}):
        group = [r for r in rows if r['scenario'] == scenario]
        summary[scenario] = dict(count=len(group), correct_known=sum(r['name'] == r['expected_name'] for r in group),
                                false_known=sum(r['name'] is not None and r['name'] != r['expected_name'] for r in group),
                                unknown=sum(r['status'] == 'unknown_candidate' for r in group),
                                needs_review=sum(r['status'] == 'needs_review' for r in group),
                                invalid_anchors=sum(not r['anchor_mapping_valid'] for r in group),
                                inference_s=sum(r['inference_s'] for r in group))
    save_json(args.output, dict(model=MODEL_ID, model_sha256=metadata['model_sha256'], strategy='seed_native_preencoder_cache',
                              thresholds=dict(minimum=args.minimum, margin=args.margin, calibrated=False),
                              summary=summary, trials=rows,
                              limitations=['Same meeting only; no cross-meeting claim.', 'Held-out enrolled people simulate unknowns; no truly novel identity test.',
                                           'No manually audited per-window ground truth.', 'Long-session channel drift and overlap not validated.',
                                           'Baseline has anonymous channels and is not an identity recognizer.']))
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['build', 'evaluate', 'match'])
    parser.add_argument('--model', type=Path, required=True)
    parser.add_argument('--library', type=Path, required=True)
    parser.add_argument('--plan', type=Path)
    parser.add_argument('--samples', type=Path)
    parser.add_argument('--audio', type=Path)
    parser.add_argument('--windows', type=Path, help='Optional labelled query-time windows for continuity testing')
    parser.add_argument('--probabilities', type=Path, help='Save all query-frame probabilities to a new NPZ')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--people', help='Comma-separated names, in chosen arrival order')
    parser.add_argument('--device', default='cuda', choices=['cuda', 'cpu'])
    parser.add_argument('--reference-seconds', type=float, default=2.)
    parser.add_argument('--silence-frames', type=int, default=0,
                        help='Learned Nemotron silence frames after each person, for delimiter ablation')
    parser.add_argument('--minimum', type=float, default=.5)
    parser.add_argument('--margin', type=float, default=.15)
    args = parser.parse_args()
    if not 0 < args.minimum < 1 or not 0 <= args.margin < 1 or args.reference_seconds <= 0 or args.silence_frames < 0:
        parser.error('Invalid thresholds/reference duration')
    if args.command in ('build', 'evaluate') and (args.plan is None or args.samples is None):
        parser.error('--plan and --samples required')
    if args.command != 'build' and (args.output is None or args.output.exists()):
        parser.error('A new --output path is required')
    if args.command == 'match' and args.audio is None:
        parser.error('--audio required')
    if args.probabilities is not None and (args.command != 'match' or args.probabilities.exists()):
        parser.error('--probabilities requires match and a new output path')
    model = load_model(args.model, args.device)
    if args.command == 'build':
        build(args, model)
    else:
        metadata, bank = load_bank(args, model)
        if args.command == 'evaluate':
            evaluate(args, model, metadata, bank)
        else:
            save_json(args.output, run_audio(args, model, args.audio, selected_people(metadata, args.people), bank))


if __name__ == '__main__':
    main()
