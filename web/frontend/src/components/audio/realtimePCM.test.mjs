import assert from 'node:assert/strict';
import test from 'node:test';
import { PCMResampler } from '../../../public/realtime-pcm.js';

for (const rate of [44100, 48000, 16000]) {
  test(`PCM ${rate} Hz conserves duration across callback boundaries`, () => {
    const converter = new PCMResampler(rate);
    const source = Float32Array.from({ length: rate * 2 }, (_, i) => Math.sin(2 * Math.PI * 440 * i / rate));
    const result = [];
    for (let i = 0; i < source.length; i += 128) result.push(...converter.push(source.subarray(i, i + 128)));
    assert.equal(result.length, 32000);
    assert.ok(result.every(value => Number.isInteger(value) && value >= -32768 && value <= 32767));
    const rms = Math.sqrt(result.reduce((sum, value) => sum + (value / 32767) ** 2, 0) / result.length);
    assert.ok(rms > .69 && rms < .72);
  });
}

test('Resampling is identical for continuous and split callbacks', () => {
  const audio = Float32Array.from({ length: 44100 }, (_, i) => Math.cos(i / 31));
  const continuous = new PCMResampler(44100).push(audio);
  const converter = new PCMResampler(44100);
  const split = [...converter.push(audio.subarray(0, 77)), ...converter.push(audio.subarray(77))];
  assert.deepEqual(split, continuous);
});

test('Worklet emits exact one-second chunks and flushes the tail before pausing', async () => {
  let Processor;
  const messages = [];
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: data => messages.push(data) }; } };
  globalThis.sampleRate = 48000;
  globalThis.registerProcessor = (_name, implementation) => { Processor = implementation; };
  await import('../../../public/realtime-pcm.js?worklet-test');
  const processor = new Processor();
  const input = [[new Float32Array(128).fill(.5)]];
  for (let i = 0; i < 400; i++) processor.process(input);
  assert.equal(messages[0].pcm.byteLength, 32000);
  processor.port.onmessage({ data: 'flush' });
  assert.equal(messages.filter(message => message.pcm).reduce((sum, message) => sum + message.pcm.byteLength / 2, 0), Math.floor(400 * 128 / 3));
  assert.equal(messages.at(-1).flushed, true);
  const count = messages.length;
  processor.process(input);
  assert.equal(messages.length, count);
  processor.port.onmessage({ data: 'resume' });
  processor.process(input);
  processor.port.onmessage({ data: 'flush' });
  assert.ok(messages.length > count);
});
