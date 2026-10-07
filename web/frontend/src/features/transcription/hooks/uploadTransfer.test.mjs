import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
const {code}=await transform(await readFile(new URL('./uploadTransfer.ts',import.meta.url),'utf8'),{loader:'ts',format:'esm'});
const {uploadTransfer}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
class XHR { static last; upload={};headers={}; constructor(){XHR.last=this;}open(method,path){this.method=method;this.path=path;}setRequestHeader(k,v){this.headers[k]=v;}send(form){this.form=form;} }
globalThis.XMLHttpRequest=XHR;
test('progress reaches 100 before the server finishes, and resolves only on completion',async()=>{
 const progress=[];const form=new FormData();form.append('topic_boundaries','[2580]');
 const pending=uploadTransfer('/upload',form,{Authorization:'Bearer test'},p=>progress.push(p));const xhr=XHR.last;
 assert.equal(xhr.headers.Authorization,'Bearer test');assert.equal(xhr.form.get('topic_boundaries'),'[2580]');
 let done=false;pending.then(()=>done=true);xhr.upload.onprogress({lengthComputable:true,loaded:100,total:100});await Promise.resolve();assert.equal(done,false);assert.deepEqual(progress,[100]);
 xhr.status=200;xhr.responseText='{"id":"job"}';xhr.onload();assert.deepEqual(await pending,{id:'job'});
});
test('quota failures surface the server error',async()=>{
 const pending=uploadTransfer('/upload',new FormData(),{},()=>{});const xhr=XHR.last;xhr.status=413;xhr.responseText='{"error":"quota exceeded"}';xhr.onload();await assert.rejects(pending,/quota exceeded/);
});
test('network failure is reported instead of completion',async()=>{
 const pending=uploadTransfer('/upload',new FormData(),{},()=>{});XHR.last.onerror();await assert.rejects(pending,/Upload failed/);
});
