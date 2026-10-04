import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transform } from 'esbuild';

const source = await readFile(new URL('./diarizationOptions.ts', import.meta.url), 'utf8');
const compiled = await transform(source, { loader: 'ts', format: 'esm' });
const { NVIDIA_DIARIZATION_OPTIONS, preferredNvidiaDiarization, speakerSelection, diarizationModelName } = await import(
    `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`
);

test('execution info shows the recorded checkpoint, not the compatibility route', () => {
    assert.equal(diarizationModelName('nvidia_sortformer', 'nvidia/Nemotron-3-Diarization'), 'Nemotron-3-Diarization');
    assert.equal(diarizationModelName('nvidia_sortformer', 'diar_streaming_sortformer_4spk-v2'), 'diar_streaming_sortformer_4spk-v2');
    assert.equal(diarizationModelName('nvidia_sortformer_4spk'), 'diar_streaming_sortformer_4spk-v2');
    assert.match(diarizationModelName('nvidia_sortformer'), /未记录模型版本/);
    assert.equal(diarizationModelName('pyannote'), 'pyannote');
});

test('two visible models use different backend keys', () => {
    assert.deepEqual(NVIDIA_DIARIZATION_OPTIONS.map(o => o.value), ['nvidia_sortformer', 'nvidia_sortformer_4spk']);
    assert.match(NVIDIA_DIARIZATION_OPTIONS[0].label, /8 人/);
    assert.match(NVIDIA_DIARIZATION_OPTIONS[1].label, /4 人/);
});

test('enabling Chunk Manager or selecting Qwen does not replace the old model choice', () => {
    assert.equal(preferredNvidiaDiarization('nvidia_sortformer_4spk'), 'nvidia_sortformer_4spk');
    assert.equal(speakerSelection('nvidia_sortformer_4spk', true, true), 'nvidia_sortformer_4spk');
    assert.equal(speakerSelection('nvidia_sortformer_4spk', false, true), 'nvidia_sortformer_4spk');
});

test('CAM++ only remains selectable outside Chunk Manager; default remains Nemotron', () => {
    assert.equal(speakerSelection('funasr_campp', false, true), 'funasr_campp');
    assert.equal(speakerSelection('funasr_campp', true, true), 'nvidia_sortformer');
    assert.equal(preferredNvidiaDiarization('pyannote'), 'nvidia_sortformer');
});
