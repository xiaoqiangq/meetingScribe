import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
const { code } = await transform(await readFile(new URL('./speakerPreview.ts', import.meta.url), 'utf8'), {loader:'ts',format:'esm'});
const { playSpeakerPreview } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
class Audio extends EventTarget {
    readyState=0; seeking=false; paused=true; time=0; plays=0;
    get currentTime(){return this.time;}
    set currentTime(value){this.time=value; this.seeking=true;}
    pause(){this.paused=true;}
    play(){this.plays++;this.paused=false;return Promise.resolve();}
    completeSeek(){this.seeking=false;this.dispatchEvent(new Event('seeked'));}
}
const callbacks=()=>({started(){},failed(message){throw Error(message)},setEnd(){}});
test('first load waits for metadata and seek completion before playing',async()=>{
 const audio=new Audio(); const stop=playSpeakerPreview(audio,{start:40,end:50},callbacks());
 assert.equal(audio.plays,0);
 audio.readyState=1;audio.dispatchEvent(new Event('loadedmetadata'));
 assert.equal(audio.currentTime,40);assert.equal(audio.plays,0);
 audio.completeSeek();await Promise.resolve();assert.equal(audio.paused,false);assert.equal(audio.plays,1);stop();assert.equal(audio.paused,true);
});
test('cached audio still seeks to the requested speaker window',()=>{
 const audio=new Audio();audio.readyState=4;
 const stop=playSpeakerPreview(audio,{start:80,end:90},callbacks());
 assert.equal(audio.currentTime,80);assert.equal(audio.plays,0);audio.completeSeek();assert.equal(audio.plays,1);stop();
});
test('closing during initial load removes listeners and prevents late playback',()=>{
 const audio=new Audio();const stop=playSpeakerPreview(audio,{start:40,end:50},callbacks());stop();
 audio.dispatchEvent(new Event('loadedmetadata'));audio.completeSeek();assert.equal(audio.plays,0);
});
test('switching clips ignores completion of the cancelled seek',()=>{
 const audio=new Audio();audio.readyState=4;
 const stop=playSpeakerPreview(audio,{start:40,end:50},callbacks());stop();
 const stop2=playSpeakerPreview(audio,{start:80,end:90},callbacks());audio.completeSeek();assert.equal(audio.plays,1);assert.equal(audio.currentTime,80);stop2();
});
