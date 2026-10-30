process.env.STORAGE_DRIVER = 'local';
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { randomUUID } = require('node:crypto');
const { join, resolve } = require('node:path');
const { unlink, mkdtemp, rm, readFile, stat } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { Readable } = require('node:stream');
const { execFileSync } = require('node:child_process');
const build = path => require(resolve(__dirname, process.env.AIGC_EDITOR_TEST_BUILD || '../dist', path));
const { prisma } = build('prisma/prisma.service');
const { CanvasService } = build('src/canvas/canvas.service');
const { EditorService } = build('src/editor/editor.service');
const { GenerationService } = build('src/generation/generation.service');
const { runMediaCommand, probeMedia, localMediaPath, EDITOR_ROOT } = build('src/editor/editor.media');
const { validateTimeline, subtitleSrt } = build('src/editor/editor.render');
const { splitTimeline, dragTimelineNode, setTimelineItemSpeed, timelineDuration, timelineLayout } = build('src/editor/timeline.logic');
const { TIMELINE_TRANSITIONS } = build('src/editor/timeline.types');
const { StorageService } = build('src/storage/storage.service');
const canvas = new CanvasService(), editor = new EditorService();
const files = new Set();
let project, red, blue, music, timeline;
const signal = AbortSignal.timeout(120000);
async function fixture(name, args) {
  const filename = `test-editor-${randomUUID()}-${name}`;
  const path = join(EDITOR_ROOT, filename); files.add(path);
  await runMediaCommand('ffmpeg', ['-nostdin','-y','-v','error',...args,path],signal);
  return { path, url: `/uploads/aigc/${filename}` };
}
before(async()=>{
  project = await canvas.createProject({ title:'Video editor integration test',episodeCount:2 });
  const a=await fixture('red.mp4',['-f','lavfi','-i','color=c=red:s=320x180:r=30:d=3','-f','lavfi','-i','sine=frequency=440:duration=3','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest']);
  const b=await fixture('blue.mp4',['-f','lavfi','-i','color=c=blue:s=320x180:r=30:d=2','-c:v','libx264','-pix_fmt','yuv420p']);
  const audio=await fixture('music.wav',['-f','lavfi','-i','sine=frequency=880:duration=3.5']);
  const nodeA=await canvas.createNode(project.id,'video',{videoUrl:a.url,title:'Red with original audio'});
  const nodeB=await canvas.createNode(project.id,'video',{videoUrl:b.url,title:'Blue without original audio'});
  await canvas.createNode(project.id,'image',{imageUrl:'https://example.com/image-not-a-video.png'});
  await canvas.createNode(project.id,'shot',{imageUrl:'https://example.com/first-frame-only.png'});
  red=await editor.importNode(project.id,1,{kind:'video',nodeId:nodeA.id});
  blue=await editor.importNode(project.id,1,{kind:'video',nodeId:nodeB.id});
  assert.equal((await editor.importNode(project.id,1,{kind:'video',nodeId:nodeA.id})).id,red.id);
  music=await editor.upload(project.id,1,{filename:audio.url.split('/').at(-1),path:audio.path,originalname:'Uploaded full-length music.wav'},'audio');
  for(const media of [red,blue,music]) files.add(await localMediaPath(media.url));
  timeline={version:1,fps:30,clips:[{id:'red-clip',shot_id:red.id,gap_before:0,source_start:15,duration:60,speed:1,volume:1,muted:true,transition:'fade',transition_duration:15,effect:''},{id:'blue-clip',shot_id:blue.id,gap_before:0,source_start:0,duration:60,speed:2,volume:1,muted:true,transition:'cut',transition_duration:0,effect:''}],audio_tracks:[{id:'music-track',shot_id:'',media_id:music.id,source:'upload',start:30,source_start:0,duration:music.duration,speed:1,volume:.6,muted:false,fade_in:0,fade_out:0}],subtitles:[{id:'caption',start:0,duration:30,text:'A real subtitle'}]};
});
after(async()=>{
  editor.onModuleDestroy();
  for(let i=0;i<100 && editor.controllers.size;i++)await new Promise(resolve=>setTimeout(resolve,20));
  if(project)await prisma.aigcProject.delete({where:{id:project.id}});
  for(const path of files)await unlink(path).catch(()=>{});
  await prisma.$disconnect();
});
async function finish(job){
  for(let i=0;i<1200;i++){
    const current=await prisma.aigcJob.findUnique({where:{id:job.id}});
    if(!['queued','running'].includes(current.status)){
      if(current.result?.url)files.add(await localMediaPath(current.result.url));
      return current;
    }
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  throw new Error('Export did not finish');
}
test('imports only generated videos and probes true source dimensions, duration and audio',async()=>{
  assert.equal(red.width,320);assert.equal(red.height,180);assert.equal(red.duration,90);assert.equal(red.hasAudio,true);assert.equal(blue.hasAudio,false);assert.equal(music.duration,105);
  const data=await editor.get(project.id,1);assert.equal(data.media.length,3);assert.equal(data.candidates.length,2);assert.ok(data.candidates.every(item=>item.mediaId));
  const second=await editor.get(project.id,2);assert.equal(second.media.length,0);assert.equal(second.timeline,null);
  await assert.rejects(editor.importNode(project.id,2,{kind:'video',nodeId:data.candidates[0].id}),/当前集没有/);
});
test('save, reload and optimistic revision conflicts retain a correct frame-based draft',async()=>{
  const saved=await editor.save(project.id,1,{timeline,revision:0});assert.equal(saved.revision,1);
  const reloaded=await editor.get(project.id,1);assert.equal(reloaded.timeline.clips.length,2);assert.equal(reloaded.timeline.audio_tracks[0].duration,105);
  await assert.rejects(editor.save(project.id,1,{timeline,revision:0}),/其他窗口/);
  assert.equal(timelineDuration(timeline),135);
  assert.equal(subtitleSrt(timeline),'1\n00:00:00,000 --> 00:00:01,000\nA real subtitle\n');
});
test('ported split, speed and trim logic preserve media ranges for video and full-length music',()=>{
  const base={...timeline,clips:timeline.clips.map(clip=>({...clip,transition:'cut',transition_duration:0,speed:1}))};
  const split=splitTimeline(base,'red-clip',30);assert.equal(split.clips.length,3);assert.equal(split.clips[1].source_start,45);
  const audio=splitTimeline(base,'music-track',60);assert.equal(audio.audio_tracks.length,2);assert.equal(audio.audio_tracks[1].source_start,30);
  const speed=setTimelineItemSpeed(base,'red-clip',2);assert.equal(timelineLayout(speed)[0].end,30);
  const trimmed=dragTimelineNode(base,'music-track','tail',300,{[`media:${music.id}`]:105});assert.equal(trimmed.audio_tracks[0].duration,105);
  assert.equal(validateTimeline(timeline,[red,blue,music]).clips[0].transition_duration,15);
  assert.throws(()=>validateTimeline({...timeline,clips:[{...timeline.clips[0],source_start:85,duration:30}]},[red,blue,music]),/裁切范围/);
  assert.throws(()=>validateTimeline({...timeline,subtitles:[null]},[red,blue,music]),/字幕参数/);
  assert.throws(()=>validateTimeline({...timeline,clips:[{...timeline.clips[0],shot_id:randomUUID()}]},[red,blue,music]),/当前集/);
});
test('16s video and audio restore their trimmed head through tail extension and export their real source ranges',async()=>{
  const videoFile=await fixture('restore16.mp4',['-f','lavfi','-i','testsrc2=size=160x90:rate=30:duration=16','-f','lavfi','-i','sine=frequency=550:duration=16','-c:v','libx264','-preset','ultrafast','-threads','2','-pix_fmt','yuv420p','-c:a','aac','-shortest']);
  const source=await editor.upload(project.id,1,{filename:videoFile.url.split('/').at(-1),path:videoFile.path,originalname:'16 second source.mp4'},'video');
  files.add(await localMediaPath(source.url));assert.equal(source.duration,480);
  const base={version:1,fps:30,clips:[{...timeline.clips[0],id:'restore-video',shot_id:source.id,source_start:0,duration:480,transition:'cut',transition_duration:0,muted:true}],audio_tracks:[{...timeline.audio_tracks[0],id:'restore-audio',media_id:source.id,source_start:0,start:0,duration:480,volume:1}],subtitles:[]};
  const frames={[`${source.id}:video`]:480,[`media:${source.id}`]:480};
  let restored=dragTimelineNode(base,'restore-video','head',180,frames);
  restored=dragTimelineNode(restored,'restore-audio','head',180,frames);
  assert.equal(restored.clips[0].duration,300);assert.equal(restored.audio_tracks[0].duration,300);
  restored=dragTimelineNode(restored,'restore-video','tail',180,frames);
  restored=dragTimelineNode(restored,'restore-audio','tail',180,frames);
  assert.deepEqual([restored.clips[0].source_start,restored.clips[0].duration],[0,480]);
  assert.deepEqual([restored.audio_tracks[0].source_start,restored.audio_tracks[0].duration],[0,480]);
  validateTimeline(restored,[source]);
  const saved=await editor.save(project.id,1,{timeline:restored,revision:1});assert.equal(saved.timeline.clips[0].duration,480);
  const videoTimeline={...restored,audio_tracks:[]};
  const video=await finish(await editor.export(project.id,1,{timeline:videoTimeline,outputFormat:'mp4',resolution:'480p'}));
  assert.equal(video.status,'succeeded',video.error);const videoPath=await localMediaPath(video.result.url);
  assert.ok(Math.abs((await probeMedia(videoPath,'video',signal)).duration-480)<=1);
  const pixels=execFileSync('ffmpeg',['-v','error','-ss','15.5','-i',videoPath,'-frames:v','1','-vf','scale=16:9','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);
  assert.ok([...pixels].some(value=>value>100),'restored video includes real frames through the original end');
  const audio=await finish(await editor.export(project.id,1,{timeline:restored,outputFormat:'mp3',resolution:'480p'}));
  assert.equal(audio.status,'succeeded',audio.error);const audioPath=await localMediaPath(audio.result.url);
  assert.ok(Math.abs((await probeMedia(audioPath,'audio',signal)).duration-660)<=2);
  const samples=execFileSync('ffmpeg',['-v','error','-ss','21.5','-i',audioPath,'-t','0.2','-ac','1','-ar','8000','-f','f32le','pipe:1']);
  let energy=0;for(let index=0;index+4<=samples.length;index+=4)energy+=samples.readFloatLE(index)**2;
  assert.ok(energy>1,'restored audio extends with real sound instead of padded silence');
});
test('FFmpeg exports actual trim, crossfade, speed, uploaded audio, subtitles and watermark to MP4',async()=>{
  const job=await editor.export(project.id,1,{timeline,outputFormat:'mp4',resolution:'480p',burnSubtitles:true,watermark:'Editor test'});
  const done=await finish(job);assert.equal(done.status,'succeeded',done.error);
  const path=await localMediaPath(done.result.url),metadata=await probeMedia(path,'video',signal);
  assert.ok(Math.abs(metadata.duration-135)<=2);assert.equal(metadata.width,854);assert.equal(metadata.height,480);assert.equal(metadata.hasAudio,true);
  const pixel=time=>execFileSync('ffmpeg',['-v','error','-ss',String(time),'-i',path,'-frames:v','1','-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);
  assert.ok(pixel(.2)[0]>150,'first trimmed clip remains red');assert.ok(pixel(2.2)[2]>150,'second sped-up clip is blue');assert.ok(pixel(3.5)[0]<30,'audio tail extends over a black frame');
  const energy=time=>{const bytes=execFileSync('ffmpeg',['-v','error','-ss',String(time),'-i',path,'-t','0.1','-vn','-ac','1','-ar','48000','-f','f32le','pipe:1']);let sum=0;for(let i=0;i+4<=bytes.length;i+=4)sum+=bytes.readFloatLE(i)**2;return Math.sqrt(sum/Math.max(1,bytes.length/4))};
  assert.ok(energy(.2)<.001,'uploaded music does not start early');assert.ok(energy(1.5)>.01,'uploaded music starts at its requested offset');
});
test('MP3 export uses the same edited and mixed audio timeline',async()=>{
  const done=await finish(await editor.export(project.id,1,{timeline,outputFormat:'mp3',resolution:'480p'}));assert.equal(done.status,'succeeded',done.error);
  const metadata=await probeMedia(await localMediaPath(done.result.url),'audio',signal);assert.ok(Math.abs(metadata.duration-135)<=2);assert.equal(metadata.width,0);
});
for(const transition of TIMELINE_TRANSITIONS)test(`FFmpeg supports the visible ${transition} transition`,async()=>{
  const short={...timeline,clips:timeline.clips.map((clip,index)=>({...clip,source_start:0,duration:30,speed:1,transition:index===0?transition:'cut',transition_duration:index===0&&transition!=='cut'?10:0})),audio_tracks:[],subtitles:[]};
  const done=await finish(await editor.export(project.id,1,{timeline:short,outputFormat:'mp4',resolution:'480p'}));
  assert.equal(done.status,'succeeded',done.error);
  const metadata=await probeMedia(await localMediaPath(done.result.url),'video',signal);
  assert.ok(Math.abs(metadata.duration-(transition==='cut'?60:50))<=2);
});
test('export cancellation prevents completed results from overwriting the interrupted state',async()=>{
  const job=await editor.export(project.id,1,{timeline,outputFormat:'mp4',resolution:'480p'});
  const tasks = new GenerationService(canvas, {}, editor);
  await tasks.cancel(project.id,job.id);const done=await finish(job);assert.equal(done.status,'cancelled');assert.equal(done.result.url,undefined);
});
test('OSS imports and mixed local/cloud timelines export real MP4 and MP3, with no published local leftovers',async()=>{
  const previous={...process.env},objects=new Map(),store=new StorageService(),cloudEditor=new EditorService(store);
  Object.assign(process.env,{STORAGE_DRIVER:'oss',R2_ENDPOINT:'https://r2.example.invalid',R2_PUBLIC_BASE_URL:'https://cdn.example.invalid',R2_BUCKET:'test-bucket',R2_REGION:'auto',R2_ACCESS_KEY_ID:'test-id',R2_SECRET_ACCESS_KEY:'test-secret'});
  store.client={send:async command=>{
    const {Key,Body}=command.input;
    if(command.constructor.name==='PutObjectCommand'){const chunks=[];if(Buffer.isBuffer(Body))chunks.push(Body);else for await(const chunk of Body)chunks.push(Buffer.from(chunk));objects.set(Key,Buffer.concat(chunks));return{}}
    if(command.constructor.name==='GetObjectCommand'){const value=objects.get(Key);assert.ok(value);return{Body:Readable.from([value]),ContentLength:value.length}}
    if(command.constructor.name==='DeleteObjectCommand'){objects.delete(Key);return{}}
    throw new Error('Unexpected S3 command');
  },destroy(){}};
  const directory=await mkdtemp(join(tmpdir(),'editor-oss-test-'));
  try{
    const fixtureFile=await fixture('cloud-source.mp4',['-f','lavfi','-i','color=c=green:s=160x90:r=30:d=2','-f','lavfi','-i','sine=frequency=660:duration=2','-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-c:a','aac','-shortest']);
    const source=await cloudEditor.upload(project.id,1,{filename:fixtureFile.url.split('/').at(-1),path:fixtureFile.path,originalname:'Cloud source.mp4'},'video');
    assert.match(source.url,/^https:\/\/cdn\.example\.invalid\/aigc\//);assert.equal(source.duration,60);
    await assert.rejects(stat(join(EDITOR_ROOT,source.url.split('/').at(-1))));
    const mixed={...timeline,clips:[{...timeline.clips[0],id:'cloud-video',shot_id:source.id,source_start:0,duration:30,speed:1,muted:false,transition:'cut',transition_duration:0},{...timeline.clips[1],source_start:0,duration:30,speed:1}],audio_tracks:[{...timeline.audio_tracks[0],media_id:source.id,start:0,source_start:0,duration:60}],subtitles:[]};
    for(const outputFormat of ['mp4','mp3']){
      const job=await cloudEditor.export(project.id,1,{timeline:mixed,outputFormat,resolution:'480p'});
      let done;for(let i=0;i<1000;i++){done=await prisma.aigcJob.findUniqueOrThrow({where:{id:job.id}});if(!['queued','running'].includes(done.status))break;await new Promise(resolve=>setTimeout(resolve,25))}
      assert.equal(done.status,'succeeded',done.error);assert.match(done.result.url,new RegExp(`^https:.*\\.${outputFormat}$`));
      const path=join(directory,`output.${outputFormat}`);await store.readObjectTo(done.result.url,path,signal);assert.ok((await readFile(path)).length>1000);
      const metadata=await probeMedia(path,outputFormat==='mp4'?'video':'audio',signal);assert.ok(Math.abs(metadata.duration-60)<=2);
      await assert.rejects(stat(join(EDITOR_ROOT,done.result.url.split('/').at(-1))));
    }
    assert.equal(objects.size,3);
  }finally{
    cloudEditor.onModuleDestroy();for(let i=0;i<200&&cloudEditor.controllers.size;i++)await new Promise(resolve=>setTimeout(resolve,10));store.onModuleDestroy();
    await rm(directory,{recursive:true,force:true});for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);
  }
});
