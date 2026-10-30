process.env.STORAGE_DRIVER = 'local';
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { CanvasService } = require('../dist/src/canvas/canvas.service.js');
const { prisma } = require('../dist/prisma/prisma.service.js');

const service = new CanvasService();
let project;

before(async () => {
  project = await service.createProject({ title: 'Canvas media history integration test' });
});

after(async () => {
  if (project) await prisma.aigcProject.delete({ where: { id: project.id } });
  await prisma.$disconnect();
});

for (const kind of ['character', 'scene', 'prop', 'image', 'audio', 'shot', 'video']) {
  test(`${kind}: replacement retains both versions and restore does not change the prompt`, async () => {
    const node = await service.createNode(project.id, kind, { episodeNumber: 1, prompt: 'Keep this prompt', universalPrompt: 'Keep this video prompt' });
    assert.deepEqual(await service.listMediaVersions(project.id, kind, node.id), []);
    const firstUrl = `https://example.com/${kind}-first`;
    const secondUrl = `https://example.com/${kind}-second`;
    await service.attachUpload(project.id, kind, node.id, firstUrl);
    await service.attachUpload(project.id, kind, node.id, secondUrl);
    const versions = await service.listMediaVersions(project.id, kind, node.id);
    assert.equal(versions.length, 2);
    assert.equal(versions.filter(version => version.isCurrent).length, 1);
    assert.equal(versions.find(version => version.isCurrent).url, secondUrl);
    assert.ok(versions.every(version => version.source === 'uploaded'));
    const first = versions.find(version => version.url === firstUrl);
    const restored = await service.restoreMediaVersion(project.id, kind, node.id, first.id);
    const mediaField = kind === 'audio' ? 'audioUrl' : kind === 'video' ? 'videoUrl' : 'imageUrl';
    assert.equal(restored[mediaField], firstUrl);
    if (kind !== 'audio') assert.equal(restored.prompt || restored.universalPrompt, ['shot', 'video'].includes(kind) ? 'Keep this video prompt' : 'Keep this prompt');
    const again = await service.listMediaVersions(project.id, kind, node.id);
    assert.equal(again.length, 2);
    assert.equal(again.find(version => version.isCurrent).id, first.id);
    const another = await service.createNode(project.id, kind, { episodeNumber: 1 });
    await assert.rejects(service.restoreMediaVersion(project.id, kind, another.id, first.id), /不属于该节点/);
    await service.deleteNode(project.id, kind, node.id);
    assert.equal(await prisma.aigcMediaVersion.count({ where: { id: { in: versions.map(version => version.id) } } }), 0);
  });
}

test('existing images are retained before replacement and a saved reference stays connected after restore', async () => {
  const node = await service.createNode(project.id, 'character', { imageUrl: 'https://example.com/existing', aspectRatio: '4:3' });
  const target = await service.createNode(project.id, 'scene', {});
  const link = await service.createLink(project.id, { episodeNumber: 1, sourceKind: 'character', sourceId: node.id, targetKind: 'scene', targetId: target.id });
  await service.updateNode(project.id, 'character', node.id, { imageUrl: 'https://example.com/new', aspectRatio: '9:16' });
  const versions = await service.listMediaVersions(project.id, 'character', node.id);
  const original = versions.find(version => version.url === 'https://example.com/existing');
  assert.equal(original.source, 'existing');
  const restored = await service.restoreMediaVersion(project.id, 'character', node.id, original.id);
  assert.equal(restored.imageUrl, original.url);
  assert.equal(restored.aspectRatio, '4:3');
  assert.ok(await prisma.aigcCanvasLink.findUnique({ where: { id: link.id } }));
});
