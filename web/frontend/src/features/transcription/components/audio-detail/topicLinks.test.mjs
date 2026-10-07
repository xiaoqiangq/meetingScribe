import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
const {code}=await transform(await readFile(new URL('./topicLinks.ts',import.meta.url),'utf8'),{loader:'ts',format:'esm'});
const {selectTopicLinks}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const link=(left,right,cosine)=>({left,right,cosine});
test('filters low scores and caps both sides to two links',()=>{
 const r=selectTopicLinks([link('a','b',.9),link('a','c',.8),link('a','d',.7),link('b','e',.6),link('f','b',.55),link('x','y',.49)],{});
 assert.equal(r.recommended.length,3);assert.equal(r.other.length,3);
 const counts={};for(const l of r.recommended)for(const s of [l.left,l.right])counts[s]=(counts[s]||0)+1;
 assert.ok(Object.values(counts).every(n=>n<=2));
});
test('reversed duplicates appear once with the strongest score',()=>{
 const r=selectTopicLinks([link('a','b',.6),link('b','a',.8)],{});assert.equal(r.recommended.length,1);assert.equal(r.recommended[0].cosine,.8);
});
test('confirmed links are separate even at low scores and do not use candidate slots',()=>{
 const r=selectTopicLinks([link('a','b',.1),link('a','c',.8),link('a','d',.7)],{a:'person1',b:'person1'});
 assert.equal(r.confirmed.length,1);assert.equal(r.recommended.length,2);
});
test('threshold changes keep all remaining valid links available under other',()=>{
 const links=[link('a','b',.6),link('a','c',.4)];const r=selectTopicLinks(links,{},.7);assert.equal(r.recommended.length,0);assert.equal(r.other.length,2);
});
test('invalid scores and self links never appear',()=>{
 assert.deepEqual(selectTopicLinks([link('a','a',1),link('a','b',NaN)],{}),{confirmed:[],recommended:[],other:[]});
});
