const assert = require('node:assert/strict');
const { test } = require('node:test');
const { resolve } = require('node:path');
const build = path => require(resolve(__dirname, process.env.AIGC_VIDEO_TEST_BUILD || '../dist', path));
const { GenerationProvider } = build('src/generation/generation.provider.js');
const { buildVideoBody, videoProtocol, wanVideoPrompt, videoTaskId, videoTaskStatus, videoTaskFailed, videoTaskSucceeded, videoResultUrl, videoFailureMessage, videoPollPath } = build('src/generation/generation.video.js');
const config = { provider: 'xingzhan', apiProtocol: 'openai', baseUrl: 'https://openapi.xingzhan.cloud/v1', apiKey: 'fake-key', runtimeParams: {}, endpoint: '', queryEndpoint: '' };
const input = { kind: 'video', model: 'doubao-seedance-2-5-260628', prompt: '角色@图片1说话，参考@音色1', aspectRatio: '16:9', duration: 5, resolution: '480p', references: [] };
const references = [
  { token: '@图片1', kind: 'image', url: 'https://reference.example.invalid/actor.jpg' },
  { token: '@视频1', kind: 'video', url: 'https://reference.example.invalid/previous.mp4' },
  { token: '@音色1', kind: 'audio', url: 'https://reference.example.invalid/voice.mp3' },
];

test('Xingzhan Seedance and Wan match aiedu universal-reference payloads without pretending to be Ark', () => {
  const seedance = buildVideoBody(config, input, references);
  assert.equal(seedance.generate_audio, true);assert.equal(seedance.resolution, '480p');assert.equal(seedance.omni_reference_task_type, 'reference');
  assert.deepEqual(seedance.media, references.map(ref => ({ type: ref.kind, url: ref.url })));assert.equal(seedance.prompt, '角色@图片1说话，参考@音频1');
  assert.equal(seedance.content, undefined);assert.equal(seedance.images, undefined);assert.equal(seedance.metadata, undefined);
  const wan = buildVideoBody(config, { ...input, model: 'wan3.0-video' }, references);
  assert.equal(wan.generate_audio, true);assert.equal(wan.resolution, '480P');assert.equal(wan.prompt, '16:9 角色Image 1说话，参考Audio 1');
  assert.deepEqual(wan.media, seedance.media);assert.equal(wan.omni_reference_task_type, undefined);
  const plain = buildVideoBody(config, input, []);assert.equal(plain.media, undefined);assert.equal(plain.omni_reference_task_type, undefined);
  assert.equal(videoProtocol({ ...config, provider: 'custom' }, input.model), 'xingzhan-seedance');
  assert.equal(videoProtocol({ ...config, baseUrl: 'https://gateway.example.invalid' }, input.model), 'xingzhan-seedance');
});

test('ordinary OpenAI-compatible endpoints retain images and are not routed by model name alone', () => {
  const ordinary = { ...config, provider: 'openai', baseUrl: 'https://ordinary.example.invalid/v1' };
  for (const model of ['test-model', 'wan3.0-video', 'doubao-seedance-2-5-260628']) {
    assert.equal(videoProtocol(ordinary, model), 'openai');
    assert.deepEqual(buildVideoBody(ordinary, { ...input, model }, [references[0]]), {
      model, prompt: input.prompt, duration: 5, ratio: '16:9', resolution: '480p', images: [references[0].url],
    });
  }
  const otherXingzhanModel = buildVideoBody(config, { ...input, model: 'test-model' }, [references[0]]);
  assert.deepEqual(otherXingzhanModel.images, [references[0].url]);assert.equal(otherXingzhanModel.media, undefined);
  assert.throws(() => buildVideoBody(ordinary, input, references), /尚不支持参考视频或音频/);
});

test('explicit Ark format wins and keeps content media roles, endpoint and resolution overrides', () => {
  for (const ark of [{ ...config, apiProtocol: 'volcengine' }, { ...config, runtimeParams: { video_format: 'ark' } }, { ...config, baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' }]) {
    const body = buildVideoBody(ark, input, references);assert.equal(videoProtocol(ark, input.model), 'ark');
    assert.equal(body.content[0].text, '角色@图片1说话，参考@音频1');assert.equal(body.watermark, false);assert.equal(body.prompt, undefined);
    assert.deepEqual(body.content.slice(1).map(part => [part.type, part.role]), [['image_url', 'reference_image'], ['video_url', 'reference_video'], ['audio_url', 'reference_audio']]);
    assert.equal(body.media, undefined);
  }
  const wanInput = { ...input, model: 'wan3.0-video' };
  const renamed = buildVideoBody({ ...config, runtimeParams: { video_resolution_param: 'size', video_resolution_value: '832*480' } }, wanInput, []);
  assert.equal(renamed.resolution, undefined);assert.equal(renamed.size, '832*480');
  assert.equal(buildVideoBody({ ...config, runtimeParams: { video_resolution_off: '1' } }, wanInput, []).resolution, undefined);
});

test('Wan ratio annotation handling retains dialogue after the annotation line', () => {
  assert.equal(wanVideoPrompt('镜头推进\n=VideoRatio: 16:9\n角色说：“不要删掉我。”', '16:9'), '16:9 镜头推进\n角色说：“不要删掉我。”');
  assert.equal(wanVideoPrompt('16:9 已有比例', '16:9'), '16:9 已有比例');
  assert.equal(wanVideoPrompt('9:16，已有比例', '9:16'), '9:16，已有比例');
});

test('aiedu result shapes include Xingzhan success fail_reason, metadata and nested wrappers', () => {
  const url = 'https://generated.example.invalid/video.mp4?sig=kept';
  for (const shape of [
    { code: 'success', data: { task_id: 'cgt-1', status: 'SUCCESS', fail_reason: url } },
    { id: 'cgt-1', status: 'completed', metadata: { url } },
    { status: 'succeeded', content: { video_url: url } },
    { output: { task_status: 'SUCCEEDED', video_url: url } },
    { data: { data: { output: { video_url: url }, status: 'completed' } } },
    { result: { result_url: url } }, { outputs: [{ url }] }, { data: [{ url }] },
  ]) assert.equal(videoResultUrl(shape), url, JSON.stringify(shape));
  for (const shape of [{ taskId: 'one' }, { data: { task_id: 'one' } }, { result: { id: 'one' } }]) assert.equal(videoTaskId(shape), 'one');
  for (const status of ['complete', 'finished', 'ok']) assert.ok(videoTaskSucceeded(videoTaskStatus({ status })));
  const failed = { data: { status: 'FAILURE', fail_reason: url, data: { error: { code: 'InvalidParameter', message: 'Incorrect input' } } } };
  assert.ok(videoTaskFailed(videoTaskStatus(failed)));assert.equal(videoResultUrl(failed), '');assert.equal(videoFailureMessage(failed), 'InvalidParameter: Incorrect input');
  assert.equal(videoResultUrl({ status: 'running', fail_reason: url }), '');
  assert.equal(videoResultUrl({ status: 'SUCCESS', fail_reason: '任务成功但没有地址', input: { url } }), '');
  assert.equal(videoResultUrl({ output: { last_frame_url: url, cover_url: url } }), '');
});

test('poll placeholders match aiedu including custom taskId and trailing slash paths', () => {
  for (const token of ['id', 'taskId', 'task_id', 'videoId', 'video_id']) assert.equal(videoPollPath(`/tasks/{${token}}?token={${token}}`, 'a/b'), '/tasks/a%2Fb?token=a%2Fb');
  assert.equal(videoPollPath('/tasks/', 'a/b'), '/tasks/a%2Fb');
});

async function runVideo(responses, overrides = {}, signal = AbortSignal.timeout(5000)) {
  const original = globalThis.fetch, calls = [], saved = [], progress = [];
  const provider = new GenerationProvider({ putBuffer: async bytes => { saved.push(bytes.toString());return '/uploads/aigc/result.mp4'; } });
  provider.waitForVideoPoll = async signal => { signal.throwIfAborted(); };
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), method: options?.method, body: options?.body && JSON.parse(options.body) });
    if (String(url) === 'https://generated.example.invalid/video.mp4') return new Response('video bytes', { headers: { 'content-type': 'video/mp4' } });
    assert.ok(responses.length, `Unexpected request ${url}`);
    const response = responses.shift();if (response instanceof Error) throw response;
    return response instanceof Response ? response : Response.json(response);
  };
  try {
    const result = await provider.generate({ ...config, ...overrides }, input, signal, async state => progress.push(state));
    return { result, calls, saved, progress };
  } finally { globalThis.fetch = original; }
}

test('actual polling waits for a delayed successful address, tolerates transient errors and POSTs exactly once', async () => {
  const { result, calls, saved, progress } = await runVideo([
    { data: { taskId: 'cgt-test', status: 'queued' } },
    Response.json({ error: { message: 'Temporary channel outage' } }, { status: 503 }),
    new TypeError('fetch failed'),
    { data: { status: 'SUCCESS', fail_reason: '' } },
    { data: { status: 'SUCCESS', fail_reason: 'https://generated.example.invalid/video.mp4' } },
  ]);
  assert.equal(result.url, '/uploads/aigc/result.mp4');assert.deepEqual(saved, ['video bytes']);
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(calls.filter(call => call.method === 'GET').length, 4);
  assert.ok(calls.filter(call => call.method === 'GET').every(call => call.url.endsWith('/video/generations/cgt-test')));
  assert.equal(progress[0].providerTaskId, 'cgt-test');assert.equal(progress.at(-1).providerStatus, 'success');
  assert.ok(progress.at(-1).providerResponseFields.includes('data.fail_reason'));
  assert.equal(JSON.stringify(progress).includes('fake-key'), false);
});

test('Ark and custom polling URLs work, and errors do not trigger another paid creation', async () => {
  const ark = await runVideo([{ id: 'ark-1', status: 'queued' }, { status: 'succeeded', content: { video_url: 'https://generated.example.invalid/video.mp4' } }], { apiProtocol: 'volcengine' });
  assert.ok(ark.calls[0].url.endsWith('/contents/generations/tasks'));assert.ok(ark.calls[1].url.endsWith('/contents/generations/tasks/ark-1'));
  const custom = await runVideo([{ result: { task_id: 'custom' } }, { metadata: { url: 'https://generated.example.invalid/video.mp4' }, status: 'complete' }], { endpoint: '/custom/create', queryEndpoint: '/custom/{taskId}/status' });
  assert.ok(custom.calls[1].url.endsWith('/custom/custom/status'));
  await assert.rejects(runVideo([{ id: 'failed', status: 'queued' }, { data: { status: 'FAILURE', data: { error: { code: 'Rejected', message: 'Content rejected' } } } }]), /Rejected: Content rejected/);
  await assert.rejects(runVideo([{ id: 'payment', status: 'queued' }, Response.json({ message: 'Insufficient balance' }, { status: 402 })]), /HTTP 402/);
  await assert.rejects(runVideo([{ id: 'forbidden', status: 'queued' }, Response.json({ message: 'Invalid key' }, { status: 401 })]), /HTTP 401/);
});

test('polling remains cancellable while success has no URL, without downloading or posting again', async () => {
  const controller = new AbortController();
  const original = globalThis.fetch;const calls = [];
  const provider = new GenerationProvider({ putBuffer: async () => { throw Error('Must not save'); } });
  provider.waitForVideoPoll = async () => { controller.abort();controller.signal.throwIfAborted(); };
  globalThis.fetch = async (_url, options) => { calls.push(options.method);return Response.json({ id: 'cancelled', status: 'SUCCESS' }); };
  try { await assert.rejects(provider.generate(config, input, controller.signal), error => error.name === 'AbortError');assert.deepEqual(calls, ['POST']); }
  finally { globalThis.fetch = original; }
});
