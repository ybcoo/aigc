const assert = require('node:assert/strict');
const { after, test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { mkdtemp, readFile, rm, stat, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { resolve, join } = require('node:path');
const { Readable } = require('node:stream');
require('dotenv/config');
const build = path => require(resolve(__dirname, process.env.AIGC_STORAGE_TEST_BUILD || '../dist', path));
const { StorageService, STORAGE_ROOT } = build('src/storage/storage.service');
const { CanvasController } = build('src/canvas/canvas.controller');
const { GenerationProvider } = build('src/generation/generation.provider');
const { prisma } = build('prisma/prisma.service');
const environment = { ...process.env };
const cleanup = new Set();
const signal = () => AbortSignal.timeout(10000);
function local() { process.env.STORAGE_DRIVER = 'local'; delete process.env.PUBLIC_ASSET_BASE_URL; return new StorageService(); }
function cloud() {
  Object.assign(process.env,{STORAGE_DRIVER:'oss',R2_ENDPOINT:'https://r2.example.invalid',R2_PUBLIC_BASE_URL:'https://cdn.example.invalid/media',R2_BUCKET:'test-bucket',R2_REGION:'auto',R2_ACCESS_KEY_ID:'test-id',R2_SECRET_ACCESS_KEY:'test-secret'});
  const storage=new StorageService(), objects=new Map(), calls=[];
  storage.client={send:async command=>{
    const type=command.constructor.name, input=command.input;calls.push({type,input});
    if(type==='PutObjectCommand'){const parts=[];if(Buffer.isBuffer(input.Body))parts.push(input.Body);else for await(const part of input.Body)parts.push(Buffer.from(part));objects.set(input.Key,Buffer.concat(parts));return{}};
    if(type==='GetObjectCommand'){const data=objects.get(input.Key);if(!data)throw new Error('missing');return{Body:Readable.from([data]),ContentLength:data.length}};
    if(type==='DeleteObjectCommand'){objects.delete(input.Key);return{}};
    throw new Error(type);
  },destroy(){}};
  return{storage,objects,calls};
}
after(async()=>{for(const path of cleanup)await rm(path,{recursive:true,force:true});for(const key of Object.keys(process.env))if(!(key in environment))delete process.env[key];Object.assign(process.env,environment);await prisma.$disconnect()});
test('local stores unchanged bytes, keeps stable upload URLs and rejects path traversal',async()=>{
  const storage=local(),name=`storage-test-${randomUUID()}.png`,bytes=Buffer.from('local image');
  const url=await storage.putBuffer(bytes,name,signal());assert.equal(url,`/uploads/aigc/${name}`);cleanup.add(await storage.localPath(url));
  assert.deepEqual(await readFile(await storage.localPath(url)),bytes);
  await assert.rejects(storage.putBuffer(bytes,'../escape.png'),/文件名/);
  await assert.rejects(storage.localPath('/uploads/aigc/../../.env'));
  await storage.remove(url);await assert.rejects(stat(join(STORAGE_ROOT,name)));
});
test('oss uses an S3 object and public URL with media headers, without falling back to local storage',async()=>{
  const {storage,objects,calls}=cloud(),name=`storage-test-${randomUUID()}.mp3`;
  const url=await storage.putBuffer(Buffer.from('audio bytes'),name,signal());assert.equal(url,`https://cdn.example.invalid/media/aigc/${name}`);
  assert.equal(objects.get(`aigc/${name}`).toString(),'audio bytes');assert.equal(calls[0].input.ContentType,'audio/mpeg');assert.equal(calls[0].input.ContentLength,11);
  await assert.rejects(stat(join(STORAGE_ROOT,name)));assert.ok(storage.isObjectUrl(url));assert.equal(storage.isObjectUrl('https://cdn.example.invalid.attacker/media/aigc/test.mp3'),false);
  const dir=await mkdtemp(join(tmpdir(),'storage-test-'));cleanup.add(dir);await storage.readObjectTo(url,join(dir,'download.mp3'),signal());assert.equal((await readFile(join(dir,'download.mp3'))).toString(),'audio bytes');
  await storage.remove(url);assert.equal(objects.size,0);
});
test('invalid modes, missing R2 credentials and failed uploads are explicit errors, never silent local writes',async()=>{
  process.env.STORAGE_DRIVER='invalid';assert.throws(()=>new StorageService().onModuleInit(),/local 或 oss/);
  const {storage}=cloud();delete process.env.R2_SECRET_ACCESS_KEY;assert.throws(()=>storage.onModuleInit(),/R2_SECRET_ACCESS_KEY/);
  process.env.R2_SECRET_ACCESS_KEY='test-secret';storage.client.send=async()=>{throw{$metadata:{httpStatusCode:403},message:'secret-should-not-leak'}};
  const name=`storage-test-${randomUUID()}.png`;await assert.rejects(storage.putBuffer(Buffer.from('bytes'),name),error=>{assert.match(error.message,/HTTP 403/);assert.doesNotMatch(error.message,/secret-should-not-leak/);return true});await assert.rejects(stat(join(STORAGE_ROOT,name)));
});
test('aborting after an R2 upload removes its unpublished object',async()=>{
  const {storage,objects}=cloud(),send=storage.client.send,controller=new AbortController();
  storage.client.send=async command=>{const result=await send(command);if(command.constructor.name==='PutObjectCommand')controller.abort();return result};
  await assert.rejects(storage.putBuffer(Buffer.from('bytes'),`storage-test-${randomUUID()}.png`,controller.signal));assert.equal(objects.size,0);
});
test('legacy local video/audio references become public in oss mode while keeping the original local file',async()=>{
  const name=`storage-test-${randomUUID()}.mp3`,localStore=local();const old=await localStore.putBuffer(Buffer.from('original voice'),name);cleanup.add(await localStore.localPath(old));
  const {storage,objects}=cloud();const url=await storage.providerReference(old,signal());assert.match(url,/^https:\/\/cdn\.example\.invalid\/media\/aigc\/reference-/);assert.equal(objects.size,1);assert.equal((await readFile(await storage.localPath(old))).toString(),'original voice');
  local();assert.equal(await new StorageService().providerReference(old,signal()),undefined);
});
test('canvas upload and reference upload publish to oss, remove staging files and clean up failed database writes',async()=>{
  const {storage,objects}=cloud();
  async function file(){const name=`storage-test-${randomUUID()}.png`,path=join(STORAGE_ROOT,name);await writeFile(path,'uploaded bytes');cleanup.add(path);return{path,filename:name,originalname:'input.png'}}
  const first=await file();let reference;
  const controller=new CanvasController({attachUpload:async(_p,_k,_id,url)=>({imageUrl:url}),attachReference:async(...args)=>{reference=args;return{}}},storage);
  const uploaded=await controller.upload('project','image','node',first);assert.match(uploaded.data.imageUrl,/^https:/);await assert.rejects(stat(first.path));
  const second=await file();await controller.uploadReference('project','video','node','image',second,2);assert.equal(reference.at(-1),2);assert.match(reference[4],/^https:/);await assert.rejects(stat(second.path));
  const third=await file();const failing=new CanvasController({attachUpload:async()=>{throw new Error('DB failure')}},storage);
  await assert.rejects(failing.upload('project','image','node',third),/DB failure/);assert.equal(objects.size,2);await assert.rejects(stat(third.path));
});
test('generated image and video results use the same R2 storage path and leave no local output',async()=>{
  const {storage,objects,calls}=cloud(),provider=new GenerationProvider(storage),fetch=globalThis.fetch;
  const config={apiProtocol:'openai',provider:'xingzhan',baseUrl:'https://provider.example.invalid',endpoint:'',queryEndpoint:'',runtimeParams:{}};
  const input={kind:'image',model:'test-model',prompt:'test',aspectRatio:'1:1',duration:5,resolution:'480p',references:[]};
  globalThis.fetch=async(url,options)=>{if(String(url).startsWith('data:'))return fetch(url,options);if(String(url).endsWith('/images/generations'))return Response.json({data:[{b64_json:Buffer.from('generated image').toString('base64')}]});if(String(url).endsWith('/video/generations'))return Response.json({video_url:'https://output.example.invalid/generated.mp4'});if(String(url)==='https://output.example.invalid/generated.mp4')return new Response('generated video',{headers:{'content-type':'video/mp4'}});throw new Error('Unexpected network access')};
  try{const image=await provider.generate(config,input,signal());const video=await provider.generate(config,{...input,kind:'video'},signal());assert.match(image.url,/^https:.*\.png$/);assert.match(video.url,/^https:.*\.mp4$/);assert.equal(objects.size,2);assert.ok(calls.some(call=>call.type==='PutObjectCommand'&&call.input.ContentType==='video/mp4'));for(const key of objects.keys())await assert.rejects(stat(join(STORAGE_ROOT,key.split('/').at(-1))));}finally{globalThis.fetch=fetch}
});
