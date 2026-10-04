"""Opt-in identity matching with Nemotron's own encoder, outside its mutable cache."""
import argparse
import hashlib
import json
import time
from pathlib import Path
import numpy as np
import trial


def unit(x):
    return x / np.maximum(np.linalg.norm(x,axis=-1,keepdims=True),1e-12)


def pool_features(model,audio,sr=16000):
    import torch
    if sr!=16000 or audio.ndim!=1 or len(audio)<16000:
        raise ValueError('Expected at least one second of mono 16kHz audio')
    x=torch.as_tensor(audio,dtype=torch.float32,device=model.device)[None]
    lengths=torch.tensor([len(audio)],device=model.device)
    with torch.inference_mode():
        mel,mel_lengths=model.process_signal(x,lengths)
        hidden,hidden_lengths=model.frontend_encoder(mel,mel_lengths)
        hidden=hidden[:,:int(hidden_lengths[0])]
        mask=model.sortformer_modules.length_to_mask(hidden_lengths,hidden.shape[1])
        pre,pre_lengths=model._call_pre_encode(mel.transpose(1,2),mel_lengths)
        layers={'encoder':hidden[0],'preencoder':pre[0,:int(pre_lengths[0])]}
        if model.transformer_encoder is not None:
            transformer=model.transformer_encoder(encoder_states=hidden,encoder_mask=mask)
            layers['transformer']=transformer[0]
        result={}
        for layer,frames in layers.items():
            # Discard only the unstable clip boundaries, equally for reference and query.
            trim=min(3,max(0,(len(frames)-8)//2))
            if trim:frames=frames[trim:-trim]
            mean=frames.mean(0);std=frames.std(0,unbiased=False)
            result[layer+'_mean']=mean.cpu().numpy()
            result[layer+'_meanstd']=torch.cat([mean,std]).cpu().numpy()
    return result


def fit_geometry(vectors,labels):
    vectors=unit(vectors)
    center=vectors.mean(0)
    transformed=unit(vectors-center)
    names=sorted(set(labels))
    prototypes=unit(np.stack([transformed[np.asarray(labels)==name].mean(0) for name in names]))
    return center,transformed,names,prototypes


def choose_configuration(features,labels):
    reports=[]
    for key in features[0]:
        vectors=np.stack([f[key] for f in features])
        correct=0;positive=[];negative=[];gaps=[]
        for i,label in enumerate(labels):
            keep=np.arange(len(labels))!=i
            center,_,names,prototypes=fit_geometry(vectors[keep],list(np.asarray(labels)[keep]))
            scores=unit(unit(vectors[i])-center)@prototypes.T
            own=names.index(label);rivals=np.delete(scores,own)
            positive.append(float(scores[own]));negative.append(float(rivals.max()))
            gaps.append(float(scores[own]-rivals.max()));correct+=names[int(scores.argmax())]==label
        reports.append(dict(feature=key,correct=int(correct),count=len(labels),positive=positive,negative=negative,gaps=gaps,
                            worst_gap=min(gaps),mean_gap=float(np.mean(gaps))))
    best=max(reports,key=lambda r:(r['correct'],r['worst_gap'],r['mean_gap']))
    # Thresholds depend only on enrollment reference leave-one-out, never on the evaluation audio.
    minimum=max(best['negative'])+.02
    margin=max(.05,min(best['gaps'])/2)
    return best['feature'],minimum,margin,reports


def decide(scores,names,minimum,margin,reference_consistency=None):
    order=np.argsort(-scores);top=int(order[0]);score=float(scores[top]);gap=float(score-scores[order[1]])
    if score<minimum:
        status='unknown_candidate';name=None
    elif gap<margin or (reference_consistency is not None and reference_consistency<2):
        status='needs_review';name=None
    else:status='known_candidate';name=names[top]
    return dict(status=status,name=name,score=score,gap=gap,scores={n:float(s) for n,s in zip(names,scores)})


def main():
    import soundfile as sf
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model',type=Path,required=True)
    parser.add_argument('--plan',type=Path,required=True)
    parser.add_argument('--samples',type=Path,required=True)
    parser.add_argument('--audio',type=Path,required=True)
    parser.add_argument('--windows',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    if args.output.exists():raise ValueError('Existing output is never overwritten')
    model=trial.load_model(args.model,'cuda')
    plan=json.loads(args.plan.read_text());enrolled=[s for s in plan['samples'] if s['role']=='reference']
    features=[];labels=[]
    start=time.perf_counter()
    for sample in enrolled:
        path=args.samples/sample['file']
        if trial.sha256(path)!=sample['audio_sha256']:raise ValueError('Reference audio hash mismatch')
        audio,sr=sf.read(path,dtype='float32');features.append(pool_features(model,audio,sr));labels.append(sample['name'])
    key,minimum,margin,calibration=choose_configuration(features,labels)
    vectors=np.stack([f[key] for f in features]);center,reference_vectors,names,prototypes=fit_geometry(vectors,labels)
    fingerprint=hashlib.sha256(vectors.tobytes()).hexdigest()
    audio,sr=sf.read(args.audio,dtype='float32')
    rows=[]
    for window in json.loads(args.windows.read_text()):
        clip=audio[round(window['start']*sr):round(window['end']*sr)]
        encoded=pool_features(model,clip,sr)[key]
        embedding=unit(unit(encoded)-center);scores=embedding@prototypes.T
        reference_scores=embedding@reference_vectors.T
        nearest=np.argsort(-reference_scores)[:3]
        top=names[int(scores.argmax())]
        consistency=sum(labels[int(i)]==top for i in nearest)
        decision=decide(scores,names,minimum,margin,consistency)
        # expected_name is evaluation metadata; it is read only after inference/decision.
        row=dict(window,**decision,reference_consistency=int(consistency))
        if 'expected_name' in window:
            row['correct_known']=decision['name']==window['expected_name'] if window['expected_name'] else False
            row['false_known']=decision['name'] is not None and decision['name']!=window['expected_name']
            row['correct_unknown']=window['expected_name'] is None and decision['status']=='unknown_candidate'
        rows.append(row)
    summary={}
    for label in sorted(set(r.get('expected_group','unlabelled') for r in rows)):
        group=[r for r in rows if r.get('expected_group','unlabelled')==label]
        summary[label]=dict(count=len(group),correct_known=sum(r.get('correct_known',False) for r in group),
            correct_unknown=sum(r.get('correct_unknown',False) for r in group),false_known=sum(r.get('false_known',False) for r in group),
            needs_review=sum(r['status']=='needs_review' for r in group),unknown=sum(r['status']=='unknown_candidate' for r in group))
    if hashlib.sha256(vectors.tobytes()).hexdigest()!=fingerprint:raise ValueError('Immutable reference vectors changed')
    trial.save_json(args.output,dict(strategy='Nemotron native hidden feature matching with immutable references',
        feature=key,minimum=minimum,margin=margin,identity_calibrated=False,calibration=calibration,
        summary=summary,rows=rows,reference_fingerprint=fingerprint,model_sha256=trial.sha256(args.model),
        elapsed_s=time.perf_counter()-start,known_people=names,
        limitations=['Feature pooling is experimental, not a trained speaker embedding head.',
                     'Evaluation labels are user-reviewed channel identities, not exhaustive per-window ground truth.',
                     'Unknown thresholds lack a separate unknown calibration population.']))
    print(json.dumps(dict(feature=key,minimum=minimum,margin=margin,summary=summary),ensure_ascii=False),flush=True)


if __name__=='__main__':main()
