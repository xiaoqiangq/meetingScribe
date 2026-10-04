#!/usr/bin/env python3
"""Nemotron-only topic feature ranking. All identities require human confirmation."""
import argparse
import hashlib
import json
import time
import uuid
from pathlib import Path
import numpy as np
import soundfile as sf
from native_identifier import pool_features, choose_configuration, fit_geometry, unit
from trial import load_model, sha256


def select_windows(segments, speaker):
    candidates=[]
    for s in segments:
        if s['speaker']!=speaker: continue
        pieces=[(s['start']+.25,s['end']-.25)]
        for other in segments:
            if other['speaker']==speaker: continue
            remaining=[]
            for a,b in pieces:
                if other['end']<=a or other['start']>=b: remaining.append((a,b))
                else:
                    if other['start']>a: remaining.append((a,min(b,other['start'])))
                    if other['end']<b: remaining.append((max(a,other['end']),b))
            pieces=remaining
        for a,b in pieces:
            if b-a>=3:
                center=(a+b)/2;half=min(6,b-a)/2
                candidates.append(dict(start=center-half,end=center+half))
    candidates.sort(key=lambda w:w['start'])
    if len(candidates)>5:candidates=[candidates[round(i*(len(candidates)-1)/4)] for i in range(5)]
    return candidates


def ranked(vector,names,prototypes,person_ids):
    values=vector@prototypes.T
    return sorted([dict(person_id=person_ids[n],name=n,cosine=float(v)) for n,v in zip(names,values)],key=lambda row:row['cosine'],reverse=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('model','plan','samples','audio','diarization','output'):
        parser.add_argument('--'+name,type=Path,required=True)
    parser.add_argument('--device',default='cuda',choices=['cpu','cuda'])
    parser.add_argument('--evaluation-windows',type=Path)
    parser.add_argument('--evaluation-audio',type=Path)
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    if (args.output/'topic-recommendations.json').exists():raise ValueError('Use a new output directory; existing experiments are retained')
    started=time.perf_counter()
    model_hash=sha256(args.model)
    if model_hash!='867c53f552998f772e5b5e5c082962ae85ee7ca5669c2bc17d7f615133d4e96d':raise ValueError('Unexpected Nemotron checkpoint')
    model=load_model(args.model,args.device)
    plan=json.loads(args.plan.read_text());features=[];labels=[];provenance=[]
    # Only RAW AUDIO from the existing sample plan is consumed. Its TitaNet
    # model metadata and SQLite vectors are never read or compared.
    for sample in plan['samples']:
        if sample['role']!='reference':continue
        path=args.samples/sample['file']
        if sha256(path)!=sample['audio_sha256']:raise ValueError('Reference audio changed')
        audio,sr=sf.read(path,dtype='float32')
        features.append(pool_features(model,audio,sr));labels.append(sample['name'])
        provenance.append({k:sample[k] for k in ('name','file','start','end','audio_sha256')})
    key,minimum,margin,calibration=choose_configuration(features,labels)
    raw=np.stack([f[key] for f in features]);center,reference_vectors,names,prototypes=fit_geometry(raw,labels)
    person_ids={n:str(uuid.uuid5(uuid.NAMESPACE_URL,plan['source_job']+':'+next(s['speaker'] for s in plan['samples'] if s['name']==n))) for n in names}
    np.savez(args.output/'nemotron-reference-features.npz',raw=raw,center=center,reference_vectors=reference_vectors,prototypes=prototypes,labels=np.asarray(labels),names=np.asarray(names))
    reference=dict(model='nvidia/Nemotron-3-Diarization',model_sha256=model_hash,feature=key,pooling='boundary-trimmed mean or mean+std, L2, enrollment-only centering, L2',source_job=plan['source_job'],source_audio_sha256=plan['source_audio_sha256'],samples=provenance,feature_selection='enrollment leave-one-out only',calibration=calibration,identity_calibrated=False)
    (args.output/'native-reference-library.json').write_text(json.dumps(reference,ensure_ascii=False,indent=2))
    audio,sr=sf.read(args.audio,dtype='float32')
    if sr!=16000 or audio.ndim!=1:raise ValueError('Expected mono 16kHz meeting')
    segments=json.loads(args.diarization.read_text())['segments'];rows=[];centroids={};stored={}
    for speaker in sorted({s['speaker'] for s in segments}):
        windows=select_windows(segments,speaker)
        vectors=[unit(unit(pool_features(model,audio[round(w['start']*sr):round(w['end']*sr)],sr)[key])-center) for w in windows]
        row=dict(speaker=speaker,topic=speaker.split('/')[0] if '/' in speaker else 'recording',windows=windows,status='insufficient_audio',suggested_name=None,scores=[])
        if vectors:
            matrix=np.stack(vectors);centroid=unit(matrix.mean(0));scores=ranked(centroid,names,prototypes,person_ids)
            excerpt_scores=[ranked(v,names,prototypes,person_ids) for v in matrix]
            votes=[r[0]['name'] for r in excerpt_scores]
            row.update(status='needs_review',scores=scores,excerpt_votes=votes,excerpt_scores=excerpt_scores,agreement=[float(v@centroid) for v in matrix],top_candidate=scores[0]['name'],top_vote_count=votes.count(scores[0]['name']),candidate_gap=scores[0]['cosine']-scores[1]['cosine'])
            centroids[speaker]=centroid;stored[speaker.replace('/','__')]=matrix
        rows.append(row)
    np.savez(args.output/'nemotron-topic-features.npz',**stored)
    # Rank cross-topic candidates using the same enrollment geometry. No
    # identity is automatically merged, and no rank score is a probability.
    links=[]
    for i,a in enumerate(rows):
        if a['speaker'] not in centroids:continue
        for b in rows[i+1:]:
            if a['topic']==b['topic'] or b['speaker'] not in centroids:continue
            links.append(dict(left=a['speaker'],right=b['speaker'],cosine=float(centroids[a['speaker']]@centroids[b['speaker']]),status='needs_confirmation'))
    links.sort(key=lambda r:r['cosine'],reverse=True)
    report=dict(speakers=rows,links=links,model='nvidia/Nemotron-3-Diarization',model_sha256=model_hash,feature=key,source_audio_sha256=sha256(args.audio),identity_calibrated=False,thresholds_provisional=True,automatic_identity_assignment=False,notice='仅使用 Nemotron 自身特征；姓名候选需试听确认，排序分数不是正确概率。')
    (args.output/'topic-recommendations.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    if args.evaluation_windows:
        if not args.evaluation_audio:raise ValueError('Evaluation audio required')
        evaluation_audio,evaluation_sr=sf.read(args.evaluation_audio,dtype='float32');evaluation=[]
        for window in json.loads(args.evaluation_windows.read_text()):
            vector=unit(unit(pool_features(model,evaluation_audio[round(window['start']*evaluation_sr):round(window['end']*evaluation_sr)],evaluation_sr)[key])-center)
            scores=ranked(vector,names,prototypes,person_ids)
            above=scores[0]['cosine']>=minimum and scores[0]['cosine']-scores[1]['cosine']>=margin
            evaluation.append(dict(window,scores=scores,top_candidate=scores[0]['name'],passes_reference_only_gate=bool(above)))
        (args.output/'evaluation-ranking.json').write_text(json.dumps(dict(rows=evaluation,minimum=minimum,margin=margin,gate_for_audit_only=True,not_applied_to_user_names=True),ensure_ascii=False,indent=2))
    print(json.dumps(dict(feature=key,reference_clips=len(labels),topic_speakers=len(rows),links=len(links),seconds=time.perf_counter()-started,output=str(args.output)),ensure_ascii=False),flush=True)

if __name__=='__main__':main()
