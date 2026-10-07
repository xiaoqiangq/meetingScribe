"""Run FSMN VAD and ForcedAligner in the unchanged upload Qwen environment."""
import base64
import json
import os
from pathlib import Path
import sys

protocol = sys.stdout
sys.stdout = sys.stderr
import numpy as np
import torch
from qwen_asr import Qwen3ForcedAligner
from funasr import AutoModel
sys.path.insert(0, os.getenv("REALTIME_SHARED_FUNASR", str(Path(__file__).resolve().parents[1] / "funasr")))
from qwen3_transcribe import _aligned_words, VAD_DIR

aligner = Qwen3ForcedAligner.from_pretrained(os.environ["REALTIME_ALIGNER_MODEL"], device_map="cuda", dtype=torch.bfloat16)
vad = AutoModel(model=str(VAD_DIR), device="cpu", disable_update=True, disable_pbar=True)
cache, active = {}, False
last_speech_end = None

for line in sys.stdin:
    try:
        message = json.loads(line)
        action = message["action"]
        audio = np.frombuffer(base64.b64decode(message.get("pcm", ""), validate=True), dtype="<i2").astype(np.float32) / 32768
        if action == "ready":
            reply = dict(ready=True)
        elif action == "reset":
            cache, active = {}, False
            last_speech_end = None
            reply = {}
        elif action == "chunk":
            endpoint, voiced = False, active
            output = vad.generate(input=audio, cache=cache, is_final=False, chunk_size=1000, disable_pbar=True)
            for start, end in output[0].get("value", []) if output else []:
                if start >= 0:
                    active, voiced = True, True
                if end >= 0:
                    active, endpoint = False, True
                    last_speech_end = end / 1000
            reply = dict(voiced=voiced, endpoint=endpoint, speech_end=last_speech_end)
        elif action == "align":
            text, offset, language = message["text"], message["offset"], message["language"]
            with torch.inference_mode():
                items = aligner.align(audio=(audio, 16000), text=text, language=language)[0].items
            timings = [[(offset+i.start_time)*1000, (offset+i.end_time)*1000] for i in items]
            words = _aligned_words(text,timings,None,offset,offset+len(audio)/16000,[i.text for i in items])
            reply = dict(words=words or [], segments=[dict(start=offset,end=offset+len(audio)/16000,text=text,speaker=None)])
        else:
            raise ValueError("Unknown alignment action")
    except Exception as exc:
        import traceback
        traceback.print_exc(file=sys.stderr)
        reply = dict(error=str(exc))
    protocol.write(json.dumps(reply,ensure_ascii=False)+"\n")
    protocol.flush()
