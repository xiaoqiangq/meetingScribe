import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {transform} from 'esbuild';
const {code}=await transform(await readFile(new URL('./meetingPersonId.ts',import.meta.url),'utf8'),{loader:'ts',format:'esm'});
const {createMeetingPersonId}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
test('manual person IDs use a UUID and remain distinct',()=>{
 const values=Array.from({length:100},()=>createMeetingPersonId(webcrypto));
 assert.equal(new Set(values).size,100);
 assert.ok(values.every(value=>/^meeting:[0-9a-f-]{36}$/.test(value)));
});
test('manual confirmation still creates valid unique IDs without randomUUID on HTTP',()=>{
 const source={getRandomValues:webcrypto.getRandomValues.bind(webcrypto)};
 const values=Array.from({length:100},()=>createMeetingPersonId(source));
 assert.equal(new Set(values).size,100);
 assert.ok(values.every(value=>/^meeting:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)));
});
