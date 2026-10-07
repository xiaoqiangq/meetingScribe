import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transform } from 'esbuild';

const source = await readFile(new URL('./mediaDuration.ts', import.meta.url), 'utf8');
const compiled = await transform(source, { loader: 'ts', format: 'esm' });
const { formatMediaTime, isKnownDuration, recoverMediaDuration } = await import(
    `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`
);

class Probe extends EventTarget {
    duration = NaN;
    currentTime = 0;
    src = '';
    loads = 0;
    load() { this.loads++; }
    removeAttribute(name) { if (name === 'src') this.src = ''; }
    emit(event) { this.dispatchEvent(new Event(event)); }
}

test('unknown and invalid times never render Infinity or NaN', () => {
    for (const value of [Infinity, -Infinity, NaN, -1]) {
        assert.equal(formatMediaTime(value), '--:--');
        assert.equal(isKnownDuration(value), false);
    }
    assert.equal(isKnownDuration(0), false);
    assert.equal(formatMediaTime(0), '00:00');
    assert.equal(formatMediaTime(16.98), '00:16');
    assert.equal(formatMediaTime(3671), '61:11');
});

test('WebM EOF recovery publishes actual duration once and releases its silent probe', () => {
    const probe = new Probe();
    const durations = [];
    const cancel = recoverMediaDuration('/recording.webm', value => durations.push(value), () => probe);
    assert.equal(probe.src, '/recording.webm');
    assert.equal(probe.muted, true);
    probe.duration = Infinity;
    probe.emit('loadedmetadata');
    assert.equal(probe.currentTime, 1e10);
    assert.deepEqual(durations, []);
    probe.duration = 16.98;
    probe.emit('durationchange');
    probe.emit('seeked');
    assert.deepEqual(durations, [16.98]);
    assert.equal(probe.src, '');
    assert.equal(probe.loads, 2);
    cancel();
    assert.equal(probe.loads, 2);
});

test('switching recordings cancels recovery and cannot publish stale duration', () => {
    const probe = new Probe();
    const durations = [];
    const cancel = recoverMediaDuration('/old.webm', value => durations.push(value), () => probe);
    cancel();
    probe.duration = 12;
    probe.emit('durationchange');
    assert.deepEqual(durations, []);
    assert.equal(probe.src, '');
});

test('failed or timed-out metadata recovery releases resources without a fake duration', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    for (const event of ['error', 'timeout']) {
        const probe = new Probe();
        recoverMediaDuration('/unavailable.webm', () => assert.fail('unexpected duration'), () => probe);
        if (event === 'error') probe.emit('error');
        else t.mock.timers.tick(30_000);
        assert.equal(probe.src, '');
        assert.equal(probe.loads, 2);
    }
});
