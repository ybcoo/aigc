const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { resolve, join } = require('node:path');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
require('dotenv/config');
const { StorageService } = require(resolve(__dirname, process.env.AIGC_STORAGE_TEST_BUILD || '../dist', 'src/storage/storage.service'));
const storage = new StorageService();
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2S8AAAAASUVORK5CYII=', 'base64');
async function main() {
  if (storage.driver !== 'oss') throw new Error('此检查仅用于 OSS，请设置 STORAGE_DRIVER=oss');
  const directory = await mkdtemp(join(tmpdir(), 'aigc-storage-check-'));
  let url;
  try {
    url = await storage.putBuffer(pixel, `storage-check-${randomUUID()}.png`, AbortSignal.timeout(60000));
    await storage.readObjectTo(url, join(directory, 'pixel.png'), AbortSignal.timeout(30000));
    assert.deepEqual(await readFile(join(directory, 'pixel.png')), pixel);
    const origin = (process.env.FRONTEND_ORIGIN || 'http://localhost:3000').split(',')[0].trim();
    const response = await fetch(url, { headers: { Origin: origin, Range: 'bytes=0-7' }, signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 206, '公网域名必须支持 Range 读取');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), pixel.subarray(0, 8));
    const cors = ['*', origin].includes(response.headers.get('access-control-allow-origin'));
    console.log(JSON.stringify({ driver: storage.driver, upload: 'ok', s3Read: 'ok', publicRead: 'ok', range: 'ok', contentType: response.headers.get('content-type'), browserCors: cors ? 'ok' : 'needs-configuration' }));
    if (!cors) process.exitCode = 2;
  } finally {
    if (url) await storage.remove(url);
    await rm(directory, { recursive: true, force: true });storage.onModuleDestroy();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
