import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
const { code } = await transform(await readFile(new URL('./topicTimes.ts', import.meta.url), 'utf8'), {loader:'ts',format:'esm'});
const { validateTopicTimes } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
test('reported five-topic case has no preview and identifies the fourth boundary',()=>{
 const v=validateTopicTimes('00:43:00,01:03:16,02:01:53,05:50:26',10430);
 assert.deepEqual(v.points,[]);assert.deepEqual(v.outside,{index:4,point:21026,duration:10430});
});
test('corrected boundaries produce four cuts for five topics',()=>{
 assert.deepEqual(validateTopicTimes('43:00,01:03:16,02:01:53,02:50:26',10430),{points:[2580,3796,7313,10226]});
});
test('equal to file end is also invalid',()=>assert.equal(validateTopicTimes('02:53:50',10430).outside.index,1));
test('bad format, duplicate, reversed, zero and empty inputs cannot generate a preview',()=>{
 for(const text of ['43:99','43:00,43:00','43:00,20:00','00:00','']) {
  const v=validateTopicTimes(text,10430);assert.deepEqual(v.points,[]);assert.ok(v.error);
 }
});
test('unknown or nonfinite duration defers only duration checks to the server',()=>{
 for(const duration of [undefined,NaN,Infinity]) assert.deepEqual(validateTopicTimes('43:00',duration),{points:[2580]});
 assert.ok(validateTopicTimes('43:99').error);
});
