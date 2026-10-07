import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
const result = await build({entryPoints:[new URL('./normalizeTranscript.ts',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'esm'});
const {normalizeTranscriptResponse: normalize} = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
test('uploaded and live results use the same normalized confirmed text and timestamps',()=>{
 const input={text:'會議記錄',segments:[{start:0,end:2,text:'會議記錄',speaker:'speaker_0'}],word_segments:[{start:0,end:1,word:'會議',score:.9,speaker:'speaker_0'}],partial:{text:'待確認'}};
 const live=normalize({transcript:input});const saved=normalize(JSON.parse(JSON.stringify({available:true,transcript:input})));
 assert.deepEqual(live,saved);assert.equal(live.text,'会议记录');assert.equal(live.word_segments[0].word,'会议');assert.equal(live.segments[0].end,2);assert.equal(live.segments[0].speaker,'speaker_0');assert.equal('partial' in live,false);
 assert.equal(input.text,'會議記錄');
});
test('empty, legacy text and segment-only transcripts remain supported',()=>{
 assert.equal(normalize(null),null);assert.equal(normalize({available:false,transcript:{text:'x'}}),null);assert.equal(normalize({transcript:null}),null);
 assert.equal(normalize({transcript:'會議'}).text,'会议');
 assert.equal(normalize({transcript:{segments:[{text:'會議',start:0,end:1}]}}).text,'会议');
 assert.deepEqual(normalize({transcript:{text:'',segments:[],word_segments:[]}}),{text:'',segments:[],word_segments:[]});
});

test('live marker and unresolved word roles survive normalization without changing upload results',()=>{
 const input={text:'测试',metadata:{mode:'realtime'},segments:[{start:0,end:1,text:'测试',speaker:null}],word_segments:[{start:0,end:1,word:'测试',score:1,speaker:null}]};
 const live=normalize({transcript:input});assert.equal(live.realtime,true);assert.equal(live.word_segments[0].speaker,null);
 const uploaded=normalize({transcript:{...input,metadata:{}}});assert.equal('realtime' in uploaded,false);
});
