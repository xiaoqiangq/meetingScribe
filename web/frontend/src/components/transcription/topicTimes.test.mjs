import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
const output = mkdtempSync(join(tmpdir(), 'topic-times-'));
execFileSync('node', ['node_modules/typescript/bin/tsc', 'src/components/transcription/topicTimes.ts', '--outDir', output, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck']);
const { parseTopicTimes, formatTopicTime } = createRequire(import.meta.url)(join(output, 'topicTimes.js'));
test('43-minute boundary uses full-recording seconds', () => {
  assert.deepEqual(parseTopicTimes('43:00'), [2580]);
  assert.deepEqual(parseTopicTimes('43:00, 01:00:00'), [2580, 3600]);
  assert.equal(formatTopicTime(3796), '01:03:16');
});
test('reject ambiguous, repeated and reversed boundaries', () => {
  for (const value of ['', '0:00', '43', '43:60', '1:60:00', '43:00,43:00', '43:00,20:00']) assert.throws(() => parseTopicTimes(value));
});
