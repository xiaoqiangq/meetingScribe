import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transform } from 'esbuild';

const source = await readFile(new URL('./transcriptDisplay.ts', import.meta.url), 'utf8');
const compiled = await transform(source, { loader: 'ts', format: 'esm' });
const { prepareTranscriptForDisplay, shouldStartNewParagraph, splitDisplayWordsIntoSentences, groupRealtimeParagraphs, appendReadingParagraph, shouldAttachRealtimeDraft } = await import(
    `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`
);

test('joins an unfinished sentence across an ASR chunk without changing timestamps', () => {
    const original = {
        text: '我们还是遵循那个经典的一个。生理病理的一个过程的一个特点呢，',
        segments: [
            { start: 10, end: 15, speaker: 'speaker_1', text: '我们还是遵循那个经典的一个。' },
            { start: 15.2, end: 20, speaker: 'speaker_1', text: '生理病理的一个过程的一个特点呢，' },
        ],
        word_segments: [
            { start: 14, end: 15, word: '个。', score: 0, speaker: 'speaker_1' },
            { start: 15.2, end: 15.5, word: '生', score: 0, speaker: 'speaker_1' },
        ],
    };
    const displayed = prepareTranscriptForDisplay(original);
    assert.equal(displayed.segments[0].text, '我们还是遵循那个经典的一个');
    assert.equal(displayed.word_segments[0].word, '个');
    assert.equal(displayed.word_segments[0].start, 14);
    assert.equal(displayed.word_segments[0].end, 15);
    assert.equal(original.segments[0].text, '我们还是遵循那个经典的一个。');
    assert.equal(shouldStartNewParagraph(displayed.segments[0].text, displayed.segments[1].text, 0, 50), false);
    assert.deepEqual(
        splitDisplayWordsIntoSentences(displayed.word_segments).map(sentence => sentence.map(word => word.word).join('')),
        ['个生']
    );
});

test('retains punctuation at a speaker change or real sentence ending', () => {
    const changedSpeaker = prepareTranscriptForDisplay({
        text: '',
        segments: [
            { start: 0, end: 2, speaker: 'speaker_1', text: '这是一个。' },
            { start: 2.1, end: 4, speaker: 'speaker_2', text: '新的问题。' },
        ],
    });
    assert.equal(changedSpeaker.segments[0].text, '这是一个。');

    const completeSentence = prepareTranscriptForDisplay({
        text: '',
        segments: [
            { start: 0, end: 2, speaker: 'speaker_1', text: '这个问题讲完了。' },
            { start: 2.1, end: 4, speaker: 'speaker_1', text: '接下来讨论别的。' },
        ],
    });
    assert.equal(completeSentence.segments[0].text, '这个问题讲完了。');
    assert.equal(shouldStartNewParagraph('这个问题讲完了。', '接下来讨论别的。', 0, 50), true);
});

test('does not join across a long pause', () => {
    const displayed = prepareTranscriptForDisplay({
        text: '',
        segments: [
            { start: 0, end: 2, text: '我准备了一个。' },
            { start: 5, end: 7, text: '新的报告。' },
        ],
    });
    assert.equal(displayed.segments[0].text, '我准备了一个。');
});

test('starts reading paragraphs only after a sentence, not at the character limit', () => {
    const words = [
        { start: 0, end: 1, word: '前一句。', score: 0 },
        { start: 1, end: 2, word: '我们还是遵循那个经典的一个', score: 0 },
        { start: 2, end: 3, word: '生理病理的一个过程的一个特点呢。', score: 0 },
    ];
    assert.deepEqual(splitDisplayWordsIntoSentences(words).map(sentence => sentence.length), [1, 2]);
    assert.equal(shouldStartNewParagraph('我们还是遵循那个经典的一个', words[2].word, 0, 50), false);
    assert.equal(shouldStartNewParagraph('前一句。', words[1].word, 0, 50), true);
});


test('live sentences from one speaker read as one paragraph without changing source data', () => {
    const segments = [
        {start:0,end:1,text:'我们先看',speaker:'speaker_0'},
        {start:1,end:2,text:'今天的议题。',speaker:'speaker_0'},
        {start:2,end:3,text:'然后讨论方案。',speaker:'speaker_0'},
    ];
    const before = JSON.stringify(segments);
    const paragraphs = groupRealtimeParagraphs(segments);
    assert.equal(paragraphs.length,1);
    assert.equal(paragraphs[0].text,'我们先看今天的议题。然后讨论方案。');
    assert.deepEqual([paragraphs[0].start,paragraphs[0].end],[0,3]);
    assert.equal(JSON.stringify(segments),before);
});

test('live paragraphs separate speaker turns, unconfirmed labels and pauses', () => {
    const segments = [
        {start:0,end:1,text:'甲',speaker:'speaker_0'},
        {start:1,end:2,text:'乙',speaker:'speaker_1'},
        {start:2,end:3,text:'待确认',speaker:null},
        {start:3,end:4,text:'继续',speaker:undefined},
        {start:8,end:9,text:'停顿后',speaker:null},
    ];
    assert.deepEqual(groupRealtimeParagraphs(segments).map(p=>p.text),['甲','乙','待确认继续','停顿后']);
});

test('live draft attaches inline and revised/final responses never duplicate it', () => {
    const confirmed = [{start:0,end:1,text:'Hello',speaker:'speaker_0'}];
    const first = groupRealtimeParagraphs(confirmed,{start:1,end:2,text:'wor',speaker:'speaker_0'});
    const revised = groupRealtimeParagraphs(confirmed,{start:1,end:3,text:'world',speaker:'speaker_0'});
    assert.equal(first.length,1);
    assert.equal(revised[0].text,'Hello');
    assert.equal(revised[0].draft,'world');
    assert.equal(revised[0].end,3);
    const final = groupRealtimeParagraphs([...confirmed,{start:1,end:3,text:'world',speaker:'speaker_0'}],{start:3,end:3,text:''});
    assert.equal(final[0].text,'Hello world');
    assert.equal(final[0].draft,'');
    assert.equal(groupRealtimeParagraphs(confirmed,{start:1,end:2,text:'other',speaker:'speaker_1'}).length,2);
});

test('live speaker reassignment regroups full results and long turns stay readable', () => {
    const same = [{start:0,end:1,text:'甲',speaker:null},{start:1,end:2,text:'乙',speaker:null}];
    assert.equal(groupRealtimeParagraphs(same).length,1);
    assert.equal(groupRealtimeParagraphs(same.map((s,i)=>({...s,speaker:`speaker_${i}`}))).length,2);
    assert.equal(groupRealtimeParagraphs([{start:0,end:30,text:'字'.repeat(220)+'。',speaker:'speaker_0'},{start:30,end:50,text:'下一句',speaker:'speaker_0'}]).length,2);
});

test('mixed aligned and fallback fragments merge without losing source times or word indices',()=>{
 const p=[];
 const aligned={start:0,end:1,text:'我们',fullText:'我们',speaker:'a',offsets:[{startChar:0,endChar:2,startTime:0,endTime:1,wordIndex:0}]};
 const fallback={start:1,end:2,text:'讨论',fullText:'讨论',speaker:'a',offsets:[{startChar:0,endChar:2,startTime:1,endTime:2}]};
 const next={start:2,end:3,text:'方案。',fullText:'方案。',speaker:'a',offsets:[{startChar:0,endChar:3,startTime:2,endTime:3,wordIndex:1}]};
 appendReadingParagraph(p,aligned);appendReadingParagraph(p,fallback);appendReadingParagraph(p,next);
 assert.equal(p.length,1);assert.equal(p[0].fullText,'我们讨论方案。');
 assert.deepEqual(p[0].offsets.map(o=>[o.startChar,o.endChar,o.startTime,o.wordIndex]),[[0,2,0,0],[2,4,1,undefined],[4,7,2,1]]);
 assert.equal(fallback.fullText,'讨论');
});
test('shared merge preserves actual turns, long pauses, and unknown identity',()=>{
 const p=[];const fragment=(text,start,speaker)=>({text,fullText:text,start,end:start+1,speaker,offsets:[]});
 appendReadingParagraph(p,fragment('甲',0,'a'));appendReadingParagraph(p,fragment('乙',1,'b'));
 appendReadingParagraph(p,fragment('未知',2,null));appendReadingParagraph(p,fragment('继续',3,undefined));
 appendReadingParagraph(p,fragment('停顿',15,undefined));
 assert.deepEqual(p.map(x=>x.fullText),['甲','乙','未知继续','停顿']);
});
test('live draft attaches to the ongoing turn and changed speakers remain distinct',()=>{
 const last={start:0,end:2,text:'今天讨论',speaker:'a'};
 assert.equal(shouldAttachRealtimeDraft(last,{start:2,end:3,text:'项目',speaker:'a'}),true);
 assert.equal(shouldAttachRealtimeDraft(last,{start:2,end:3,text:'项目',speaker:null}),true);
 assert.equal(shouldAttachRealtimeDraft(last,{start:2,end:3,text:'我来回答',speaker:'b'}),false);
 assert.equal(shouldAttachRealtimeDraft(last,{start:20,end:21,text:'后来',speaker:'a'}),false);
 assert.equal(shouldAttachRealtimeDraft(last,{start:2,end:2,text:''}),false);
});


test('upload and realtime presentation preserve the same raw labels and word timestamps', () => {
    const original={text:'这个平台可以使用。',segments:[
        {start:0,end:1,text:'这个平',speaker:'speaker_0',speaker_status:'provisional'},
        {start:1,end:1.2,text:'台',speaker:null,speaker_status:'pending'},
        {start:1.2,end:3,text:'可以使用。',speaker:'speaker_0',speaker_status:'confirmed'},
    ],word_segments:[
        {start:0,end:1,word:'这个平',score:1,speaker:'speaker_0'},
        {start:1,end:1.2,word:'台',score:1,speaker:null},
        {start:1.2,end:3,word:'可以使用。',score:1,speaker:'speaker_0'},
    ]};
    const before=JSON.stringify(original);
    const upload=prepareTranscriptForDisplay(original);
    const live=prepareTranscriptForDisplay({...original,realtime:true});
    assert.deepEqual(live.segments,upload.segments);
    assert.deepEqual(live.word_segments,upload.word_segments);
    assert.equal(live.word_segments[1].speaker,'speaker_0');
    assert.equal(original.word_segments[1].speaker,null);
    assert.equal(JSON.stringify(original),before);
});

test('confirmation and alignment states do not split a reading paragraph', () => {
    const paragraphs=[];
    const append=(text,start,alignment_status,speaker_status)=>appendReadingParagraph(paragraphs,
        {text,fullText:text,start,end:start+1,speaker:'speaker_0',alignment_status,speaker_status,
            offsets:[{startChar:0,endChar:text.length,startTime:start,endTime:start+1,wordIndex:start}]});
    append('甲',0,'complete','provisional');
    append('乙',1,'pending','pending');
    append('丙',2,'complete','confirmed');
    assert.equal(paragraphs.length,1);
    assert.equal(paragraphs[0].fullText,'甲乙丙');
    assert.deepEqual(paragraphs[0].offsets.map(o=>[o.startChar,o.endChar,o.startTime,o.endTime,o.wordIndex]),
        [[0,1,0,1,0],[1,2,1,2,1],[2,3,2,3,2]]);
});


test('unlabelled ASR fragments follow the preceding voice across boundaries without changing source', () => {
    const original={text:'麻烦死了。你觉得呢？暂停吧。',segments:[
        {start:20,end:22.8,text:'麻烦死',speaker:'speaker_0'},
        {start:22.8,end:22.88,text:'了。',speaker:null},
        {start:23.44,end:24,text:'你觉得',speaker:'speaker_0'},
        {start:24,end:24.56,text:'呢？',speaker:null},
        {start:30,end:35.56,text:'暂停',speaker:'speaker_0'},
        {start:35.56,end:36.7,text:'吧。',speaker:null},
    ]};
    const before=JSON.stringify(original);
    for(const wordAligned of [false,true]) {
        const input=wordAligned?{...original,word_segments:original.segments.map(s=>({...s,word:s.text,score:1}))}:original;
        const shown=prepareTranscriptForDisplay(input);
        assert.ok(shown.segments.every(s=>s.speaker==='speaker_0'));
        if(wordAligned) assert.ok(shown.word_segments.every(w=>w.speaker==='speaker_0'));
        const paragraphs=[];
        for(const s of shown.segments)appendReadingParagraph(paragraphs,{...s,fullText:s.text,offsets:[]});
        assert.equal(paragraphs.length,1);
        assert.equal(paragraphs[0].fullText,original.text);
        assert.deepEqual(shown.segments.map(s=>[s.start,s.end]),original.segments.map(s=>[s.start,s.end]));
    }
    assert.equal(JSON.stringify(original),before);
});

test('leading unknown stays unnamed, explicit turns win, and a last word voice carries into the next fragment', () => {
    const input={text:'开头甲乙继续丙后续',segments:[
        {start:0,end:1,text:'开头',speaker:null},
        {start:1,end:3,text:'甲乙',speaker:'a'},
        {start:3,end:4,text:'继续',speaker:null},
        {start:4,end:5,text:'丙',speaker:'c'},
        {start:5,end:6,text:'后续',speaker:null},
    ],word_segments:[
        {start:0,end:1,word:'开头',speaker:null,score:1},
        {start:1,end:2,word:'甲',speaker:'a',score:1},
        {start:2,end:3,word:'乙',speaker:'b',score:1},
        {start:3,end:4,word:'继续',speaker:null,score:1},
        {start:4,end:5,word:'丙',speaker:null,score:1},
        {start:5,end:6,word:'后续',speaker:null,score:1},
    ]};
    const shown=prepareTranscriptForDisplay(input);
    assert.deepEqual(shown.word_segments.map(w=>w.speaker),[null,'a','b','b','c','c']);
    assert.deepEqual(shown.segments.map(s=>s.speaker),[null,'a','b','c','c']);
    assert.equal(input.word_segments[3].speaker,null);
});
