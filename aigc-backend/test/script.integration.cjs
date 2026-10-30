process.env.STORAGE_DRIVER = 'local';
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { resolve } = require('node:path');
const build = path => require(resolve(__dirname, process.env.AIGC_SCRIPT_TEST_BUILD || '../dist', path));
const { prisma } = build('prisma/prisma.service');
const { CanvasService } = build('src/canvas/canvas.service');
const { ScriptService } = build('src/script/script.service');
const { GenerationService } = build('src/generation/generation.service');
const { scriptChunks, parseExtractedAssets } = build('src/script/script.extraction');
const canvas = new CanvasService();
let handler = async () => ({ content: '{"assets":[]}' });
const provider = { generate: (...args) => handler(...args) };
const script = new ScriptService(provider);
const projects = [], configs = [];
let project, other, config, imageConfig, tiger;
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
async function waitUntil(predicate) { for (let i=0;i<400;i++) { if (await predicate()) return; await tick(); } throw Error('Timed out'); }
async function finish(job) { let result; await waitUntil(async()=>{result=await prisma.aigcJob.findUniqueOrThrow({where:{id:job.id}});return !['queued','running'].includes(result.status)});return result; }
const request = kind => ({ kind, modelId: `${config.id}:test-text`, aspectRatio: '16:9' });
const reply = (assets, kind = 'character') => ({ content: JSON.stringify({assets: assets.map(asset => ({kind, ...asset}))}) });
before(async()=>{
  project=await canvas.createProject({title:'Script extraction regression',episodeCount:3});projects.push(project.id);
  other=await canvas.createProject({title:'Unrelated script project'});projects.push(other.id);
  config=await prisma.aigcAIConfig.create({data:{serviceType:'text',name:'Script test fake provider',baseUrl:'https://example.invalid/v1',models:['test-text'],defaultModel:'test-text'}});configs.push(config.id);
  imageConfig=await prisma.aigcAIConfig.create({data:{serviceType:'image',name:'Script test image fake provider',baseUrl:'https://example.invalid/v1',models:['test-image'],defaultModel:'test-image'}});configs.push(imageConfig.id);
  tiger=await canvas.createNode(project.id,'character',{name:'白虎',prompt:'User-edited visual identity',imageUrl:'https://example.com/tiger.png',episodeNumber:1});
  await script.save(project.id,1,{content:'暮色荒原，白虎与凤凰对峙。凤凰展开双翼，白虎挥爪。全片无人物，无对白。'});
  await script.save(project.id,2,{content:'白虎再次来到荒原，凤凰停在石台旁。白虎亦被称为虎神。'});
});
after(async()=>{
  script.onModuleDestroy();await waitUntil(()=>script.controllers.size===0);
  for(const id of projects)await prisma.aigcProject.delete({where:{id}});
  await prisma.aigcAIConfig.deleteMany({where:{id:{in:configs}}});await prisma.$disconnect();
});
test('every episode has its own editable script and new episodes start without other episode assets',async()=>{
  assert.match((await script.get(project.id,1)).scriptContent,/白虎/);
  assert.equal((await script.get(project.id,3)).scriptContent,'');
  assert.equal((await canvas.getCanvas(project.id,2)).assets.length,0);
  assert.equal((await canvas.getNode(project.id,'script',project.episodes[0].id)).id,project.episodes[0].id);
});
test('home creation atomically preserves the original first-episode script, settings and preferred extraction model',async()=>{
  const content='【中景】甲说：“不要删改这句对白。”\n【远景】镜头移向古城。';
  const created=await canvas.createProject({title:'Home creation test',scriptContent:content,genre:'古风奇幻',style:'水彩手绘',aspectRatio:'9:16',episodeCount:3,textModelId:`${config.id}:test-text`});projects.push(created.id);
  assert.equal(created.episodes.length,3);assert.equal(created.episodes[0].scriptContent,content);assert.ok(created.episodes.slice(1).every(episode=>episode.scriptContent===''));
  assert.equal(created.genre,'古风奇幻');assert.equal(created.style,'水彩手绘');assert.equal(created.aspectRatio,'9:16');assert.equal(created.textModelId,`${config.id}:test-text`);
  let captured;handler=async(_config,input)=>{captured=input;return reply([])};
  const done=await finish(await script.extract(created.id,1,{kind:'scene'}));assert.equal(done.status,'succeeded',done.error);assert.equal(captured.model,'test-text');assert.match(captured.prompt,/水彩手绘/);
  await assert.rejects(canvas.createProject({title:'Invalid preferred text model',textModelId:`${imageConfig.id}:test-image`}),/文本模型不可用/);
});
test('adding episodes allocates unique sequential numbers concurrently and leaves existing scripts, assets and jobs untouched',async()=>{
  const created=await canvas.createProject({title:'Episode append regression',episodeCount:1,scriptContent:'第一集原始剧本',style:'水彩'});projects.push(created.id);
  await canvas.createNode(created.id,'image',{episodeNumber:1,name:'原有参考图'});
  const job=await prisma.aigcJob.create({data:{projectId:created.id,episodeNumber:1,targetId:'existing-task',kind:'canvas_image',status:'running'}});
  const results=await Promise.all(Array.from({length:4},()=>canvas.createEpisode(created.id)));
  assert.deepEqual(results.map(result=>result.episode.episodeNumber).sort(),[2,3,4,5]);
  assert.deepEqual(results.map(result=>result.episodeCount).sort(),[2,3,4,5]);
  assert.ok(results.every(result=>result.episode.scriptContent===''&&result.episode.status==='draft'&&result.episode.title===`第 ${result.episode.episodeNumber} 集`));
  const data=await canvas.getCanvas(created.id,5);
  assert.equal(data.project.episodeCount,5);assert.equal(data.project.episodes.length,5);assert.equal(data.project.style,'水彩');
  assert.deepEqual(data.assets,[]);assert.deepEqual(data.referenceNodes,[]);assert.deepEqual(data.links,[]);assert.deepEqual(data.jobs,[]);
  assert.equal((await script.get(created.id,1)).scriptContent,'第一集原始剧本');
  assert.equal((await canvas.getCanvas(created.id,1)).referenceNodes.length,1);
  assert.equal((await prisma.aigcJob.findUniqueOrThrow({where:{id:job.id}})).status,'running');
  await prisma.aigcJob.update({where:{id:job.id},data:{status:'cancelled'}});
  await assert.rejects(canvas.createEpisode('00000000-0000-4000-8000-000000000000'),/项目不存在/);
});
test('unnamed creation keeps script whitespace, and renaming changes only the project title',async()=>{
  const content='\n  【中景】甲说：“不要把正文变成名字。”\n【远景】古城落日。  \n';
  const created=await canvas.createProject({scriptContent:content,episodeCount:2,genre:'古风',style:'动漫'});projects.push(created.id);
  assert.equal(created.title,'');assert.equal(created.episodes[0].scriptContent,content);assert.equal(created.episodes[1].scriptContent,'');
  const renamed=await canvas.updateProject(created.id,{title:'  古城归人  '});assert.equal(renamed.title,'古城归人');
  let saved=await canvas.getCanvas(created.id,1);assert.equal(saved.project.title,'古城归人');assert.equal(saved.project.genre,'古风');assert.equal(saved.project.style,'动漫');assert.equal(saved.project.episodes[0].scriptContent,content);
  await canvas.updateProject(created.id,{title:''});saved=await canvas.getCanvas(created.id,1);assert.equal(saved.project.title,'');assert.equal(saved.project.episodes[0].scriptContent,content);
  await assert.rejects(canvas.updateProject('00000000-0000-4000-8000-000000000000',{title:'不存在'}),/项目不存在/);
});
test('TXT preview creates nothing; confirmed import preserves all chapters, settings and independent canvas scripts',async()=>{
  const source='书名\r\n\r\n'+Array.from({length:250},(_,index)=>`========== 第${index+1}章 标题 ==========\r\n  原文-${index+1}。\r\n\r\n`).join('');
  const settings={title:'TXT import regression',encoding:'auto',aspectRatio:'9:16',genre:'古风',style:'水彩',textModelId:`${config.id}:test-text`};
  const count=await prisma.aigcProject.count(),jobs=await prisma.aigcJob.count();
  const preview=await canvas.importScript('book.txt',Buffer.from(source),settings,true);
  assert.equal(preview.chapterCount,251);assert.equal(preview.chapters.length,100);assert.equal(preview.chapters[0].title,'前言');assert.equal(preview.chapters[1].title,'第1章 标题');
  assert.equal(await prisma.aigcProject.count(),count);assert.equal(await prisma.aigcJob.count(),jobs);
  const created=await canvas.importScript('book.txt',Buffer.from(source),settings,false);projects.push(created.id);
  assert.equal(created.episodeCount,251);assert.equal(created.episodes,undefined,'upload response must not return the book');
  const episodes=await prisma.aigcEpisode.findMany({where:{projectId:created.id},orderBy:{episodeNumber:'asc'}});
  assert.equal(episodes.map(episode=>episode.scriptContent).join(''),source);assert.ok(episodes.every(episode=>episode.status==='imported'));
  const data=await canvas.getCanvas(created.id,251);assert.equal(data.project.episodes.length,251);assert.equal(data.project.episodes[250].scriptContent,episodes[250].scriptContent);
  assert.ok(data.project.episodes.slice(0,250).every(episode=>episode.scriptContent===undefined),'only the current episode body should be returned');
  assert.equal(data.project.aspectRatio,'9:16');assert.equal(data.project.genre,'古风');assert.equal(data.project.style,'水彩');assert.equal(data.project.textModelId,settings.textModelId);
  assert.deepEqual(data.links,[]);assert.deepEqual(data.assets,[]);assert.deepEqual(data.jobs,[]);
  assert.equal((await canvas.listProjects()).find(project=>project.id===created.id).episodes.length,0);
  const saved=episodes[0].scriptContent;await script.save(created.id,251,{content:'仅编辑最后一集'});
  assert.equal((await script.get(created.id,1)).scriptContent,saved);assert.equal((await script.get(created.id,251)).scriptContent,'仅编辑最后一集');
  await assert.rejects(canvas.importScript('book.pdf',Buffer.from(source),settings,false),/TXT/);
});
test('multipart TXT import endpoint validates files and preview parameters before creating a project',async()=>{
  const {Test}=require('@nestjs/testing');const{ValidationPipe}=require('@nestjs/common');const request=require('supertest');
  const {CanvasModule}=build('src/canvas/canvas.module');
  const module=await Test.createTestingModule({imports:[CanvasModule]}).compile();const app=module.createNestApplication();
  app.setGlobalPrefix('api');app.useGlobalPipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true}));await app.init();
  try{
    const count=await prisma.aigcProject.count();
    const response=await request(app.getHttpServer()).post('/api/projects/import-script?preview=true').field('encoding','auto').attach('file',Buffer.from('第1章 开始\n正文\n第2章 结束\n最后\n'),'upload.txt').expect(200);
    assert.equal(response.body.data.chapterCount,2);assert.equal(await prisma.aigcProject.count(),count);
    await request(app.getHttpServer()).post('/api/projects/import-script?preview=true').field('encoding','invalid').attach('file',Buffer.from('正文'),'upload.txt').expect(400);
    await request(app.getHttpServer()).post('/api/projects/import-script?preview=invalid').attach('file',Buffer.from('正文'),'upload.txt').expect(400);
    await request(app.getHttpServer()).post('/api/projects/import-script?preview=true').attach('file',Buffer.from('正文'),'upload.pdf').expect(400);
    await request(app.getHttpServer()).post('/api/projects/import-script?preview=true').expect(400);
    assert.equal(await prisma.aigcProject.count(),count);
    const imported=await request(app.getHttpServer()).post('/api/projects/import-script').field('title','HTTP import test').field('style','水彩').attach('file',Buffer.from('\n  无章节正文\r\n'),'upload.txt').expect(201);
    projects.push(imported.body.data.id);assert.equal(imported.body.data.episodeCount,1);
    const data=await canvas.getCanvas(imported.body.data.id,1);assert.equal(data.project.episodes[0].scriptContent,'\n  无章节正文\r\n');assert.equal(data.project.style,'水彩');
    const appended=await request(app.getHttpServer()).post(`/api/projects/${imported.body.data.id}/episodes`).expect(201);
    assert.equal(appended.body.data.episode.episodeNumber,2);assert.equal(appended.body.data.episode.scriptContent,'');assert.equal(appended.body.data.episodeCount,2);
    await request(app.getHttpServer()).post('/api/projects/00000000-0000-4000-8000-000000000000/episodes').expect(404);
  }finally{await app.close()}
});
test('genre and visual style are saved project-wide, snapshotted per task and included in new image prompts',async()=>{
  await script.save(project.id,1,{content:(await script.get(project.id,1)).scriptContent,genre:'玄幻修仙',style:'国风二维动漫'});
  const second=await script.get(project.id,2);assert.equal(second.project.genre,'玄幻修仙');assert.equal(second.project.style,'国风二维动漫');
  let captured;handler=async(_config,input)=>{captured=input;return reply([{name:'赤霄',prompt:'神兽赤霄，赤红羽毛'}])};
  const done=await finish(await script.extract(project.id,1,request('character')));
  assert.equal(done.status,'succeeded',done.error);assert.equal(done.input.genre,'玄幻修仙');assert.equal(done.input.style,'国风二维动漫');
  assert.match(captured.systemPrompt,/本次唯一任务.*角色/);assert.match(captured.prompt,/玄幻修仙/);assert.match(captured.prompt,/国风二维动漫/);
  const asset=await prisma.aigcAsset.findUniqueOrThrow({where:{id:done.result.assetIds[0]}});assert.match(asset.prompt,/题材：玄幻修仙/);assert.match(asset.prompt,/视觉风格：国风二维动漫/);
  await canvas.deleteNode(project.id,'character',asset.id,1);
});
test('wrong-category entries are rejected and re-extracted instead of relabelled and saved',async()=>{
  let calls=0;
  handler=async(_config,input)=>{
    calls++;
    if(calls===1)return reply([{name:'秦宇',kind:'character'},{name:'背包',kind:'prop'}]);
    assert.match(input.prompt,/非场景/);assert.match(input.prompt,/不要把其他分类改写 kind/);
    return reply([{name:'暮色荒原'}],'scene');
  };
  const done=await finish(await script.extract(project.id,1,request('scene')));
  assert.equal(done.status,'succeeded',done.error);assert.equal(calls,2);
  const scenes=await prisma.aigcAsset.findMany({where:{projectId:project.id,kind:'scene',episodeNumber:1}});
  assert.deepEqual(scenes.map(asset=>asset.name),['暮色荒原']);
  await canvas.deleteNode(project.id,'scene',scenes[0].id,1);
  calls=0;handler=async()=>{calls++;return reply([{name:'秦宇',kind:'character'},{name:'背包',kind:'prop'}])};
  const bad=await finish(await script.extract(project.id,1,request('scene')));assert.equal(bad.status,'failed');assert.equal(calls,2);assert.match(bad.error,/非场景/);
  assert.equal(await prisma.aigcAsset.count({where:{projectId:project.id,kind:'scene',episodeNumber:1}}),0);
});
test('non-human characters extract as image assets, and reusing an existing asset preserves its prompt and media history',async()=>{
  handler=async()=>reply([{name:'白虎',description:'Not allowed to overwrite user text',existingAssetId:tiger.id},{name:'凤凰',description:'火焰双翼的神兽',prompt:'凤凰，火焰羽翼'},{name:'凤凰',description:'Same entity repeated'}]);
  const job=await finish(await script.extract(project.id,1,request('character')));
  assert.equal(job.status,'succeeded',job.error);assert.equal(job.result.created,1);assert.equal(job.result.reused,1);assert.equal(job.result.assetIds.length,2);
  const data=await canvas.getCanvas(project.id,1);assert.equal(data.assets.length,2);
  const saved=data.assets.find(asset=>asset.id===tiger.id);assert.equal(saved.imageUrl,tiger.imageUrl);assert.equal(saved.prompt,tiger.prompt);
  assert.ok(!data.links.some(link=>link.sourceKind==='script'),'extraction must not automatically connect the script node');
  assert.equal((await canvas.listMediaVersions(project.id,'character',tiger.id)).length,1);
});
test('another episode reuses the same resource IDs, including an explicitly recognized alias, rather than copying pictures',async()=>{
  handler=async()=>reply([{name:'虎神',existingAssetId:tiger.id},{name:'凤凰'}]);
  const job=await finish(await script.extract(project.id,2,request('character')));
  assert.equal(job.status,'succeeded',job.error);assert.equal(job.result.created,0);assert.equal(job.result.reused,2);
  const first=await canvas.getCanvas(project.id,1),second=await canvas.getCanvas(project.id,2);
  assert.deepEqual(second.assets.map(asset=>asset.id).sort(),first.assets.map(asset=>asset.id).sort());
  assert.equal(second.assets.find(asset=>asset.id===tiger.id).imageUrl,tiger.imageUrl);
  assert.equal((await canvas.getCanvas(project.id,3)).assets.length,0);
});
test('characters, scenes and props can run in parallel and produce independent jobs',async()=>{
  const pending=[];
  handler=(_config,input)=>new Promise(resolve=>pending.push({resolve,input}));
  const jobs=await Promise.all(['character','scene','prop'].map(kind=>script.extract(project.id,2,request(kind))));
  await waitUntil(()=>pending.length===3);
  assert.equal(new Set(jobs.map(job=>job.targetId)).size,3);
  for(const item of pending)item.resolve(item.input.prompt.includes('实际出现的场景')?reply([{name:'荒原'}],'scene'):item.input.prompt.includes('实际出现的道具')?reply([{name:'石台'}],'prop'):reply([{name:'白虎'}]));
  const done=await Promise.all(jobs.map(finish));assert.ok(done.every(job=>job.status==='succeeded'));
  const data=await canvas.getCanvas(project.id,2);
  assert.equal(data.assets.length,4);
  assert.equal(data.links.filter(link=>link.sourceKind==='script').length,0,'none of the three extraction categories should create script links');
});
test('extracting an existing resource retains manually created script connections without adding new ones',async()=>{
  const manual=await canvas.createLink(project.id,{episodeNumber:2,sourceKind:'script',sourceId:project.episodes[1].id,targetKind:'character',targetId:tiger.id});
  try{
    handler=async()=>reply([{name:'白虎',existingAssetId:tiger.id},{name:'无默认连线的角色'}]);
    const done=await finish(await script.extract(project.id,2,request('character')));assert.equal(done.status,'succeeded',done.error);
    const data=await canvas.getCanvas(project.id,2);
    assert.deepEqual(data.links.filter(link=>link.sourceKind==='script').map(link=>link.id),[manual.id]);
    const added=data.assets.find(asset=>asset.name==='无默认连线的角色');assert.ok(added);
    assert.ok(!data.links.some(link=>link.targetId===added.id));
    await canvas.deleteNode(project.id,'character',added.id,2);
  }finally{await canvas.deleteLink(project.id,manual.id)}
});
test('concurrent cross-episode extraction of the same new entity creates one shared asset',async()=>{
  handler=async()=>reply([{name:'清风',description:'同一个少年'}]);
  const done=await Promise.all((await Promise.all([script.extract(project.id,1,request('character')),script.extract(project.id,2,request('character'))])).map(finish));
  assert.ok(done.every(job=>job.status==='succeeded'));assert.equal(done.reduce((sum,job)=>sum+job.result.created,0),1);
  assert.equal(await prisma.aigcAsset.count({where:{projectId:project.id,name:'清风'}}),1);
});
test('empty extraction is a normal no-resources result; malformed output fails without inventing assets',async()=>{
  handler=async()=>reply([]);
  const empty=await finish(await script.extract(project.id,1,request('prop')));assert.equal(empty.status,'succeeded');assert.match(empty.result.content,/无需提取道具/);
  let calls=0;handler=async()=>{calls++;return{content:'not json'}};
  const invalid=await finish(await script.extract(project.id,1,request('prop')));assert.equal(invalid.status,'failed');assert.equal(calls,2);assert.match(invalid.error,/JSON/);
  assert.equal(await prisma.aigcAsset.count({where:{projectId:project.id,kind:'prop',episodeNumber:1}}),0);
});
test('cancel delegates through the task API and late model replies cannot publish extracted assets',async()=>{
  let release;handler=()=>new Promise(resolve=>{release=resolve});
  const job=await script.extract(project.id,1,request('scene'));await waitUntil(()=>release);
  const generation=new GenerationService(canvas,provider,undefined,script);
  const cancelled=await generation.cancel(project.id,job.id);assert.equal(cancelled.status,'cancelled');
  release(reply([{name:'Should not exist'}],'scene'));await waitUntil(()=>!script.controllers.has(job.id));
  assert.equal(await prisma.aigcAsset.count({where:{projectId:project.id,name:'Should not exist'}}),0);
});
test('editing a script during extraction prevents publishing outdated resources',async()=>{
  let release;handler=()=>new Promise(resolve=>{release=resolve});
  const job=await script.extract(project.id,1,request('scene'));await waitUntil(()=>release);
  await script.save(project.id,1,{content:'新的剧本，不再包含旧场景。'});
  release(reply([{name:'Old scene'}],'scene'));const done=await finish(job);assert.equal(done.status,'failed');assert.match(done.error,/剧本已更新/);
  assert.equal(await prisma.aigcAsset.count({where:{projectId:project.id,name:'Old scene'}}),0);
});
test('model resource IDs cannot import assets from another project or category',async()=>{
  await script.save(other.id,1,{content:'白虎出现。'});
  handler=async()=>reply([{name:'白虎',existingAssetId:tiger.id}]);
  const done=await finish(await script.extract(other.id,1,request('character')));assert.equal(done.status,'failed');assert.equal((await canvas.getCanvas(other.id,1)).assets.length,0);
});
test('shared assets use current-episode references for generation, while edits keep one shared media history',async()=>{
  const reference=await canvas.createNode(project.id,'image',{episodeNumber:2,name:'Second episode reference',imageUrl:'https://example.com/second.png'});
  await canvas.createLink(project.id,{episodeNumber:2,sourceKind:'image',sourceId:reference.id,targetKind:'character',targetId:tiger.id});
  let captured;const generator=new GenerationService(canvas,{generate:async(_config,input)=>{captured=input;return{url:'https://example.com/shared-new.png'}}});
  const job=await generator.create(project.id,'character',tiger.id,{episodeNumber:2,prompt:'保持白虎外观，参考@图片1',modelId:`${imageConfig.id}:test-image`});
  const done=await finish(job);assert.equal(done.status,'succeeded',done.error);assert.equal(job.episodeNumber,2);assert.equal(captured.references[0].url,'https://example.com/second.png');
  for(const episode of [1,2])assert.equal((await canvas.getCanvas(project.id,episode)).assets.find(asset=>asset.id===tiger.id).imageUrl,'https://example.com/shared-new.png');
  assert.equal((await canvas.listMediaVersions(project.id,'character',tiger.id)).length,2);
});
test('removing a shared image node only detaches the current episode and retains its other episode and media',async()=>{
  await canvas.deleteNode(project.id,'character',tiger.id,1);
  assert.ok(!(await canvas.getCanvas(project.id,1)).assets.some(asset=>asset.id===tiger.id));
  assert.ok((await canvas.getCanvas(project.id,2)).assets.some(asset=>asset.id===tiger.id));
  assert.equal((await canvas.listMediaVersions(project.id,'character',tiger.id)).length,2);
  await assert.rejects(canvas.deleteNode(project.id,'character',tiger.id,3),/当前集没有/);
  assert.ok((await canvas.getCanvas(project.id,2)).assets.some(asset=>asset.id===tiger.id));
});
test('long scripts are chunked without truncating content and strict parsing distinguishes invalid from empty output',()=>{
  const source='甲'.repeat(7000)+'\n'+'乙'.repeat(7000);const chunks=scriptChunks(source);assert.ok(chunks.every(chunk=>chunk.length<=6000));assert.equal(chunks.join('').replace(/\n/g,''),source.replace(/\n/g,''));
  assert.deepEqual(parseExtractedAssets('```json\n{"assets":[]}\n```'),[]);assert.throws(()=>parseExtractedAssets('{}'));assert.throws(()=>parseExtractedAssets('{"assets":[{"name":""}]}'));
});
test('project deletion cascades its records and history, but refuses active jobs and leaves other projects intact',async()=>{
  const created=await canvas.createProject({title:'Temporary deletion regression',episodeCount:2,scriptContent:'A script to remove'});
  try {
    const image=await canvas.createNode(created.id,'image',{imageUrl:'https://example.invalid/retained-file.png'});
    const video=await canvas.createNode(created.id,'video',{});
    await canvas.createNode(created.id,'text',{content:'A text node'});
    await canvas.createNode(created.id,'audio',{audioUrl:'https://example.invalid/voice.mp3'});
    const asset=await canvas.createNode(created.id,'character',{name:'Temporary character'});
    await canvas.updateNode(created.id,'image',image.id,{imageUrl:'https://example.invalid/new-file.png'});
    const versions=await canvas.listMediaVersions(created.id,'image',image.id);assert.equal(versions.length,2);
    await canvas.createLink(created.id,{episodeNumber:1,sourceKind:'image',sourceId:image.id,targetKind:'video',targetId:video.id});
    await prisma.aigcCanvasLayout.create({data:{projectId:created.id,nodeId:`image:${image.id}`,x:10,y:20}});
    await prisma.aigcEditorMedia.create({data:{projectId:created.id,sourceKey:'test-video',name:'Video',kind:'video',url:'https://example.invalid/video.mp4',duration:5}});
    const job=await prisma.aigcJob.create({data:{projectId:created.id,kind:'canvas_image',targetId:image.id}});
    for(const status of ['queued','running']){
      await prisma.aigcJob.update({where:{id:job.id},data:{status}});
      await assert.rejects(canvas.deleteProject(created.id),error=>error.getStatus()===409&&/任务正在生成/.test(error.message));
      assert.ok(await prisma.aigcProject.findUnique({where:{id:created.id}}));
      assert.equal(await prisma.aigcEpisode.count({where:{projectId:created.id}}),2);
    }
    await prisma.aigcJob.update({where:{id:job.id},data:{status:'cancelled',cancelRequested:true}});
    assert.deepEqual(await canvas.deleteProject(created.id),{id:created.id});
    for(const model of ['aigcProject','aigcEpisode','aigcAsset','aigcCanvasTextNode','aigcCanvasReferenceNode','aigcCanvasAudioNode','aigcShot','aigcCanvasLink','aigcCanvasLayout','aigcJob','aigcEditorMedia']){
      assert.equal(await prisma[model].count({where:model==='aigcProject'?{id:created.id}:{projectId:created.id}}),0,model);
    }
    assert.equal(await prisma.aigcAssetEpisode.count({where:{assetId:asset.id}}),0);
    assert.equal(await prisma.aigcMediaVersion.count({where:{id:{in:versions.map(version=>version.id)}}}),0);
    assert.ok(await prisma.aigcProject.findUnique({where:{id:other.id}}));
    await assert.rejects(canvas.deleteProject(created.id),error=>error.getStatus()===404);
  } finally { await prisma.aigcProject.deleteMany({where:{id:created.id}}); }
});
