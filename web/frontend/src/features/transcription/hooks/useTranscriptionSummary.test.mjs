import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transform } from 'esbuild';

// Exercise the actual stream consumer with mocked React/query boundaries.
const original = await readFile(new URL('./useTranscriptionSummary.ts', import.meta.url), 'utf8');
const source = original.replace(/^import .*;$/gm, '') + '\nexport const run = useSummarizer;';
const { code } = await transform(source, { loader: 'ts', format: 'cjs' });

test('completed streamed output is immediately cached for reopening, including multibyte chunks', async () => {
    const cache = new Map();
    const invalidated = [];
    const client = { setQueryData: (key, value) => cache.set(JSON.stringify(key), value), invalidateQueries: async ({queryKey}) => { invalidated.push(queryKey); } };
    const states = [];
    const module = { exports: {} };
    new Function('module', 'useQuery', 'useQueryClient', 'useAuth', 'useState', 'buildSummaryContent', 'translateUI', code)(
        module, () => {}, () => client, () => ({ getAuthHeaders: () => ({}) }),
        initial => { const state = { value: initial }; states.push(state); return [initial, value => { state.value = typeof value === 'function' ? value(state.value) : value; }]; },
        text => text, text => text,
    );
    const savedFetch = globalThis.fetch;
    const bytes = new TextEncoder().encode(JSON.stringify({type:'chunk',content:'# 会议纪要\n张三：同意。'})+'\n'+JSON.stringify({type:'done',status:'completed'})+'\n');
    globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) {
        controller.enqueue(bytes.slice(0, 5)); controller.enqueue(bytes.slice(5)); controller.close();
    } }));
    try {
        await module.exports.run('recording').generateSummary('template', 'model', 'prompt', 'input');
        assert.equal(cache.get(JSON.stringify(['summary', 'recording'])).content, '# 会议纪要\n张三：同意。');
        assert.deepEqual(invalidated, [['summary', 'recording'], ['summaryHistory', 'recording'], ['summaryHistory', 'recording']]);
        assert.equal(states[0].value, false);
        assert.equal(states[1].value, '# 会议纪要\n张三：同意。');
        assert.equal(states[2].value, null);
    } finally { globalThis.fetch = savedFetch; }
});

test('EOF without completion and explicit stream errors retain partial text without caching it as complete', async () => {
 for (const tail of ['',JSON.stringify({type:'error',status:'partial',error:'upstream failed'})+'\n']) {
  const states=[]; const cache=new Map();const module={exports:{}};
  const client={setQueryData:(key,v)=>cache.set(JSON.stringify(key),v),invalidateQueries:async()=>{}};
  new Function('module','useQuery','useQueryClient','useAuth','useState','buildSummaryContent','translateUI',code)(module,()=>{},()=>client,()=>({getAuthHeaders:()=>({})}), initial=>{const state={value:initial};states.push(state);return[initial,value=>{state.value=typeof value==='function'?value(state.value):value;}];},text=>text,text=>text);
  const previous=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({type:'chunk',content:'保留部分内容'})+'\n'+tail);
  try {
   await module.exports.run('meeting').generateSummary('template','model','prompt','input');
   assert.equal(cache.size,0); assert.equal(states[1].value,'保留部分内容');assert.ok(states[2].value);assert.equal(states[0].value,false);
  }finally{globalThis.fetch=previous;}
 }
});
