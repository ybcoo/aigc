const assert = require('node:assert/strict');
const { test } = require('node:test');
const { resolve } = require('node:path');
const { GenerationProvider, imageRequestSize } = require(resolve(__dirname, process.env.AIGC_IMAGE_TEST_BUILD || '../dist', 'src/generation/generation.provider.js'));

const sizes = {
  '1:1': '1920x1920', '16:9': '2560x1440', '9:16': '1440x2560',
  '4:3': '2240x1680', '3:4': '1680x2240', '3:2': '2400x1600', '2:3': '1600x2400',
};

test('Seedream matches aiedu dimensions and minimum pixels for every canvas ratio regardless of provider label', () => {
  for (const model of ['doubao-seedream-4-5-251128', 'seedream-5.0-lite', 'DOUBAO-SEEDREAM-4.0']) {
    for (const provider of ['xingzhan', 'openai', 'volcengine']) {
      for (const [ratio, size] of Object.entries(sizes)) {
        assert.equal(imageRequestSize(model, ratio, provider), size);
        const [w, h] = size.split('x').map(Number);
        const [rw, rh] = ratio.split(':').map(Number);
        assert.ok(w * h >= 3686400);
        assert.equal(w * rh, h * rw);
      }
    }
  }
  const [w, h] = imageRequestSize('seedream-4.5', '21:9', 'xingzhan').split('x').map(Number);
  assert.ok(w * h >= 3686400);
});

test('unrelated OpenAI and DashScope image dimensions stay unchanged', () => {
  assert.equal(imageRequestSize('gpt-image-1', '1:1', 'openai'), '1024x1024');
  assert.equal(imageRequestSize('gpt-image-1', '16:9', 'openai'), '1536x1024');
  assert.equal(imageRequestSize('gpt-image-1', '9:16', 'openai'), '1024x1536');
  assert.equal(imageRequestSize('qwen-image', '16:9', 'dashscope'), '1536x864');
  assert.equal(imageRequestSize('qwen-image', '1:1', 'xingzhan'), '1536x1536');
});

test('actual text-to-image and reference-image requests send valid Seedream sizes without changing references', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const saved = [];
  const provider = new GenerationProvider({ putBuffer: async (bytes, name) => {
    saved.push(bytes.toString());
    return `https://cdn.example.invalid/${name}`;
  } });
  globalThis.fetch = async (url, options) => {
    if (url === 'https://reference.example.invalid/image.png') return new Response('reference', { headers: { 'content-type': 'image/png' } });
    assert.ok(String(url).startsWith('https://provider.example.invalid/'));
    const body = options.body instanceof FormData ? options.body : JSON.parse(options.body);
    requests.push({ url, body });
    return Response.json({ data: [{ b64_json: Buffer.from('generated').toString('base64') }] });
  };
  // Keep result decoding local; no provider or bucket network requests occur in this test.
  const mockFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => String(url).startsWith('data:') ? originalFetch(url, options) : mockFetch(url, options);
  try {
    for (const label of ['xingzhan', 'openai', 'volcengine']) {
      for (const [aspectRatio, size] of Object.entries(sizes)) {
        for (const withReference of [false, true]) {
          const references = withReference ? [{ token: '@图片1', kind: 'image', url: 'https://reference.example.invalid/image.png' }] : [];
          const config = { provider: label, apiProtocol: label === 'volcengine' ? 'volcengine' : 'openai', baseUrl: 'https://provider.example.invalid', apiKey: 'mock' };
          const input = { kind: 'image', model: 'doubao-seedream-4-5-251128', prompt: withReference ? 'Use @图片1' : 'A kitchen', aspectRatio, duration: 5, resolution: '480p', references };
          await provider.generate(config, input, AbortSignal.timeout(5000));
          const request = requests.at(-1);
          if (request.body instanceof FormData) {
            assert.equal(request.body.get('size'), size);
            assert.equal(request.body.getAll('image[]').length, 1);
          } else {
            assert.equal(request.body.size, size);
            assert.deepEqual(request.body.image, withReference ? ['https://reference.example.invalid/image.png'] : undefined);
          }
        }
      }
    }
    assert.equal(saved.length, 42);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
