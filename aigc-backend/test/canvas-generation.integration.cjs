process.env.STORAGE_DRIVER = 'local';
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { unlink } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const build = path => require(resolve(__dirname, process.env.AIGC_GENERATION_TEST_BUILD || '../dist', path));
const { CanvasService } = build('src/canvas/canvas.service.js');
const { GenerationService } = build('src/generation/generation.service.js');
const { GenerationProvider, buildVideoBody, providerPrompt } = build('src/generation/generation.provider.js');
const { selectCanvasReferences } = build('src/canvas/canvas-context.js');
const { prisma } = build('prisma/prisma.service.js');

const canvas = new CanvasService();
const provider = new GenerationProvider();
const generation = new GenerationService(canvas, provider);
const originalFetch = globalThis.fetch;
const configs = [];
const files = [];
const calls = [];
const pendingTextRequests = new Map();
let project, textModel, imageModel, videoModel, blockNextText = false, cancelledRequest = false;
const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2S8AAAAASUVORK5CYII=';

before(async () => {
  project = await canvas.createProject({ title: 'Canvas references and generation integration test', episodeCount: 2 });
  for (const serviceType of ['text', 'image', 'video']) {
    const model = serviceType === 'video' ? 'doubao-seedance-2-5-260628' : 'test-model';
    const row = await prisma.aigcAIConfig.create({ data: { name: 'Integration mock only', serviceType, provider: 'xingzhan', baseUrl: 'https://generation.example.test', apiKey: 'fake-key-for-mocked-tests', models: [model], defaultModel: model } });
    configs.push(row);
  }
  [textModel, imageModel, videoModel] = configs;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('https://generation.example.test')) {
      const body = options?.body ? JSON.parse(options.body) : undefined;
      calls.push({ url, body });
      if (String(url).endsWith('/chat/completions')) {
        const prompt = body.messages?.[0]?.content;
        if (String(prompt).startsWith('Hold concurrent')) {
          return new Promise((resolve, reject) => {
            pendingTextRequests.set(prompt, { resolve, signal: options.signal });
            options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
          });
        }
        if (blockNextText) {
          blockNextText = false;
          return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => { cancelledRequest = true; reject(options.signal.reason); }, { once: true }));
        }
        return Response.json({ choices: [{ message: { content: 'Generated text content' } }] });
      }
      if (String(url).endsWith('/images/generations')) return Response.json({ data: [{ b64_json: pixel }] });
      if (String(url).endsWith('/video/generations')) return Response.json({ video_url: 'https://generated.example.test/video.mp4' });
    }
    if (String(url) === 'https://generated.example.test/video.mp4') return new Response('mock video bytes', { headers: { 'Content-Type': 'video/mp4' } });
    if (String(url).startsWith('data:')) return originalFetch(url, options);
    throw new Error(`Test unexpectedly attempted a network request: ${url}`);
  };
});

after(async () => {
  generation.onModuleDestroy();
  globalThis.fetch = originalFetch;
  if (project) await prisma.aigcProject.delete({ where: { id: project.id } });
  for (const config of configs) await prisma.aigcAIConfig.delete({ where: { id: config.id } });
  for (const file of files) await unlink(join(process.cwd(), `.${file}`)).catch(() => {});
  await prisma.$disconnect();
});

async function finish(job) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const current = await generation.get(project.id, job.id);
    if (!['queued', 'running'].includes(current.status)) {
      if (current.result?.url) files.push(current.result.url);
      return current;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Generation did not finish');
}

test('a connected text node seeds the downstream prompt, and later user edits are retained', async () => {
  const text = await canvas.createNode(project.id, 'text', { content: 'Use this exact upstream text' });
  const image = await canvas.createNode(project.id, 'image', {});
  const link = { episodeNumber: 1, sourceKind: 'text', sourceId: text.id, targetKind: 'image', targetId: image.id };
  await canvas.createLink(project.id, link);
  assert.equal((await canvas.getNode(project.id, 'image', image.id)).prompt, 'Use this exact upstream text');
  await canvas.updateNode(project.id, 'image', image.id, { prompt: 'My edited prompt' });
  await canvas.createLink(project.id, link);
  assert.equal((await canvas.getNode(project.id, 'image', image.id)).prompt, 'My edited prompt');
});

test('disconnecting, clearing and reconnecting text reseeds all supported node types while retaining nonempty edits', async () => {
  const source = await canvas.createNode(project.id, 'text', { content: 'Reconnect this exact text\nPreserve the second line' });
  for (const kind of ['image', 'video', 'text', 'character', 'scene', 'prop']) {
    const target = await canvas.createNode(project.id, kind, {});
    const input = { episodeNumber: 1, sourceKind: 'text', sourceId: source.id, targetKind: kind, targetId: target.id };
    let link = await canvas.createLink(project.id, input);
    await canvas.deleteLink(project.id, link.id);
    await canvas.updateNode(project.id, kind, target.id, kind === 'video' ? { universalPrompt: '' } : { prompt: '' });
    link = await canvas.createLink(project.id, input);
    let record = await canvas.getNode(project.id, kind, target.id);
    assert.equal(kind === 'video' ? record.universalPrompt : record.prompt, source.content, kind);
    await canvas.deleteLink(project.id, link.id);
    await canvas.updateNode(project.id, kind, target.id, kind === 'video' ? { universalPrompt: 'User revision' } : { prompt: 'User revision' });
    await canvas.createLink(project.id, input);
    record = await canvas.getNode(project.id, kind, target.id);
    assert.equal(kind === 'video' ? record.universalPrompt : record.prompt, 'User revision', kind);
  }
});

test('agent upload creates a separate image node and disconnect/reconnect rebuilds the reference pool', async () => {
  const target = await canvas.createNode(project.id, 'image', { imageUrl: 'https://example.com/target.png' });
  const result = await canvas.attachReference(project.id, 'image', target.id, 'image', 'https://example.com/reference.png', 'Reference');
  assert.notEqual(result.node.id, target.id);
  assert.equal(result.link.sourceKind, 'image');
  assert.equal(result.link.targetId, target.id);
  assert.equal((await canvas.getNode(project.id, 'image', target.id)).imageUrl, 'https://example.com/target.png');
  let data = await canvas.getCanvas(project.id, 1);
  assert.equal(data.contexts[`image:${target.id}`].references.length, 1);
  await canvas.deleteLink(project.id, result.link.id);
  data = await canvas.getCanvas(project.id, 1);
  assert.equal(data.contexts[`image:${target.id}`].references.length, 0);
  await canvas.createLink(project.id, { episodeNumber: 1, sourceKind: 'image', sourceId: result.node.id, targetKind: 'image', targetId: target.id });
  data = await canvas.getCanvas(project.id, 1);
  assert.equal(data.contexts[`image:${target.id}`].references[0].url, 'https://example.com/reference.png');
});

test('only mentioned connected images are actually sent to the provider, with dense provider numbering', async () => {
  const target = await canvas.createNode(project.id, 'image', {});
  await canvas.attachReference(project.id, 'image', target.id, 'image', 'https://example.com/unused.png', 'Unused');
  await canvas.attachReference(project.id, 'image', target.id, 'image', 'https://example.com/used.png', 'Used');
  const unrelated = await canvas.createNode(project.id, 'image', { imageUrl: 'https://example.com/unconnected.png' });
  const job = await generation.create(project.id, 'image', target.id, { prompt: 'Use @图片2 only', modelId: `${imageModel.id}:test-model`, aspectRatio: '4:3' });
  const completed = await finish(job);
  assert.equal(completed.status, 'succeeded', completed.error);
  assert.equal(completed.references.length, 1);
  assert.equal(completed.references[0].token, '@图片2');
  const request = calls.findLast(call => String(call.url).endsWith('/images/generations')).body;
  assert.deepEqual(request.image, ['https://example.com/used.png']);
  assert.match(request.prompt, /@图片1/);
  assert.doesNotMatch(request.prompt, /@图片2/);
  assert.equal((await canvas.getNode(project.id, 'image', target.id)).prompt, 'Use @图片2 only');
  assert.notEqual(unrelated.id, target.id);
  const versions = await canvas.listMediaVersions(project.id, 'image', target.id);
  assert.equal(versions.length, 1);
  assert.equal(versions[0].source, 'generated');
  const data = await canvas.getCanvas(project.id, 1);
  for (const link of data.links.filter(link => link.targetId === target.id)) await canvas.deleteLink(project.id, link.id);
  const snapshot = (await generation.list(project.id)).find(item => item.id === job.id);
  assert.equal(snapshot.references.length, 1);
  assert.equal(snapshot.references[0].url, 'https://example.com/used.png');
  assert.equal(snapshot.input.providerPrompt, 'Use @图片1 only');
  assert.equal(snapshot.input.configName, 'Integration mock only');
});

test('video generation submits image and voice under top-level media and retains the editable prompt', async () => {
  const target = await canvas.createNode(project.id, 'video', {});
  await canvas.attachReference(project.id, 'video', target.id, 'image', 'https://example.com/actor.png', 'Actor');
  await canvas.attachReference(project.id, 'video', target.id, 'audio', 'https://example.com/voice.mp3', 'Voice');
  const job = await generation.create(project.id, 'video', target.id, { prompt: '@图片1 uses @音色1', modelId: `${videoModel.id}:${videoModel.defaultModel}`, duration: 5, aspectRatio: '16:9' });
  const completed = await finish(job);
  assert.equal(completed.status, 'succeeded', completed.error);
  const request = calls.findLast(call => String(call.url).endsWith('/video/generations')).body;
  assert.deepEqual(request.media, [{ type: 'image', url: 'https://example.com/actor.png' }, { type: 'audio', url: 'https://example.com/voice.mp3' }]);
  assert.equal(request.omni_reference_task_type, 'reference');
  assert.equal(request.prompt, '@图片1 uses @音频1');
  assert.equal(completed.input.providerPrompt, request.prompt);
  assert.equal((await canvas.getNode(project.id, 'video', target.id)).universalPrompt, '@图片1 uses @音色1');
});

test('video provider task IDs and status survive both publication and failed polling for later diagnosis', async () => {
  for (const fails of [false, true]) {
    const target = await canvas.createNode(project.id, 'video', {});
    const videoProvider = new GenerationProvider();
    const replies = [{ data: { task_id: `upstream-${fails}`, status: 'queued' } }, fails
      ? { data: { status: 'FAILURE', error: { code: 'Rejected', message: 'Example rejection' } } }
      : { data: { status: 'SUCCESS', fail_reason: 'https://generated.example.test/video.mp4' } }];
    videoProvider.json = async () => { assert.ok(replies.length);return replies.shift(); };
    videoProvider.waitForVideoPoll = async () => {};
    const service = new GenerationService(canvas, videoProvider);
    const completed = await finish(await service.create(project.id, 'video', target.id, { prompt: 'Test video', modelId: `${videoModel.id}:${videoModel.defaultModel}` }));
    assert.equal(completed.status, fails ? 'failed' : 'succeeded', completed.error);
    assert.equal(completed.result.providerTaskId, `upstream-${fails}`);
    assert.equal(completed.result.providerStatus, fails ? 'failure' : 'success');
    assert.ok(completed.result.providerResponseFields.includes(fails ? 'data.error' : 'data.fail_reason'));
    const node = await canvas.getNode(project.id, 'video', target.id);
    if (fails) { assert.match(completed.error, /Rejected: Example rejection/);assert.equal(node.videoUrl, ''); }
    else { assert.equal(node.videoUrl, completed.result.url);assert.equal((await canvas.listMediaVersions(project.id, 'video', target.id)).length, 1); }
    service.onModuleDestroy();
  }
});

test('text generation writes output into the node without replacing the instruction', async () => {
  const target = await canvas.createNode(project.id, 'text', {});
  const job = await generation.create(project.id, 'text', target.id, { prompt: 'Write a scene', modelId: `${textModel.id}:test-model` });
  assert.equal((await finish(job)).status, 'succeeded');
  const result = await canvas.getNode(project.id, 'text', target.id);
  assert.equal(result.content, 'Generated text content');
  assert.equal(result.prompt, 'Write a scene');
});

test('video-to-video connections supply only explicitly mentioned videos and disappear after disconnecting or reconnecting', async () => {
  const source = await canvas.createNode(project.id, 'video', { title:'Reference video',videoUrl:'https://example.com/upstream.mp4' });
  const target = await canvas.createNode(project.id, 'video', {});
  const connection = { episodeNumber:1,sourceKind:'video',sourceId:source.id,targetKind:'video',targetId:target.id };
  const key = `video:${target.id}`;
  let link = await canvas.createLink(project.id, connection);
  let context = (await canvas.getCanvas(project.id,1)).contexts[key];
  assert.equal(context.references.length,1);assert.equal(context.references[0].token,'@视频1');assert.equal(context.references[0].url,source.videoUrl);
  assert.deepEqual(selectCanvasReferences('No reference selected',context.references),[]);
  const completed = await finish(await generation.create(project.id,'video',target.id,{prompt:'Use @视频1',modelId:`${videoModel.id}:${videoModel.defaultModel}`}));
  assert.equal(completed.status,'succeeded',completed.error);
  assert.deepEqual(calls.findLast(call=>String(call.url).endsWith('/video/generations')).body.media,[{type:'video',url:source.videoUrl}]);
  await canvas.deleteLink(project.id,link.id);
  context=(await canvas.getCanvas(project.id,1)).contexts[key];assert.deepEqual(context.references,[]);
  await assert.rejects(generation.create(project.id,'video',target.id,{prompt:'Use @视频1',modelId:`${videoModel.id}:${videoModel.defaultModel}`}),/已断开/);
  assert.equal((await generation.get(project.id,completed.id)).references[0].url,source.videoUrl,'historical requests remain immutable');
  link=await canvas.createLink(project.id,connection);context=(await canvas.getCanvas(project.id,1)).contexts[key];
  assert.equal(context.references[0].id,link.id);assert.equal(context.references[0].url,source.videoUrl);
});

test('cancelling aborts the provider request and never overwrites the existing output', async () => {
  const target = await canvas.createNode(project.id, 'text', { content: 'Keep the existing result' });
  blockNextText = true;
  const previousCalls = calls.length;
  const job = await generation.create(project.id, 'text', target.id, { prompt: 'Generate', modelId: `${textModel.id}:test-model` });
  for (let i = 0; i < 100 && calls.length === previousCalls; i++) await new Promise(resolve => setTimeout(resolve, 10));
  await generation.cancel(project.id, job.id);
  assert.equal((await finish(job)).status, 'cancelled');
  assert.equal(cancelledRequest, true);
  assert.equal((await canvas.getNode(project.id, 'text', target.id)).content, 'Keep the existing result');
});

test('missing mentions are rejected and multi-digit references cannot corrupt each other', () => {
  const references = [
    { id: 'a', sourceKey: 'image:a', token: '@图片1', kind: 'image', name: 'A', url: 'https://example.com/a.png' },
    { id: 'b', sourceKey: 'image:b', token: '@图片10', kind: 'image', name: 'B', url: 'https://example.com/b.png' },
  ];
  assert.equal(selectCanvasReferences('Only @图片10', references).length, 1);
  assert.equal(providerPrompt('Only @图片10', [references[1]]), 'Only @图片1');
  assert.throws(() => selectCanvasReferences('@图片3', references), /已断开/);
  const body = buildVideoBody({ ...videoModel, apiProtocol: 'volcengine' }, { model: 'seedance', prompt: 'Test', aspectRatio: '16:9', duration: 5, resolution: '480p' }, references);
  assert.equal(body.content[1].role, 'reference_image');
  assert.equal(body.content[1].image_url.url, references[0].url);
});

test('different nodes and episodes run concurrently, and cancelling one never aborts another', async () => {
  const first = await canvas.createNode(project.id, 'text', { content: 'Keep A', episodeNumber: 1 });
  const second = await canvas.createNode(project.id, 'text', { content: 'Keep B', episodeNumber: 2 });
  const [a, b] = await Promise.all([
    generation.create(project.id, 'text', first.id, { prompt: 'Hold concurrent A', modelId: `${textModel.id}:test-model` }),
    generation.create(project.id, 'text', second.id, { prompt: 'Hold concurrent B', modelId: `${textModel.id}:test-model` }),
  ]);
  for (let i = 0; i < 100 && pendingTextRequests.size < 2; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(pendingTextRequests.size, 2, 'both requests started before either finished');
  await assert.rejects(generation.create(project.id, 'text', first.id, { prompt: 'Duplicate', modelId: `${textModel.id}:test-model` }), /正在生成/);
  const tasks = await generation.list(project.id);
  assert.equal(tasks.filter(job => ['queued', 'running'].includes(job.status)).length, 2);
  assert.ok(tasks.some(job => job.id === b.id && job.episodeNumber === 2));
  await generation.cancel(project.id, a.id);
  assert.equal(pendingTextRequests.get('Hold concurrent A').signal.aborted, true);
  assert.equal(pendingTextRequests.get('Hold concurrent B').signal.aborted, false);
  assert.equal((await generation.get(project.id, b.id)).status, 'running');
  pendingTextRequests.get('Hold concurrent B').resolve(Response.json({ choices: [{ message: { content: 'B finished independently' } }] }));
  assert.equal((await finish(b)).status, 'succeeded');
  assert.equal((await finish(a)).status, 'cancelled');
  assert.equal((await canvas.getNode(project.id, 'text', first.id)).content, 'Keep A');
  assert.equal((await canvas.getNode(project.id, 'text', second.id)).content, 'B finished independently');
});
