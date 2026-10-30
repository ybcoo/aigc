export type CanvasReference = { id: string; sourceKey: string; kind: 'image' | 'video' | 'audio'; token: string; name: string; url: string };
export type CanvasContext = { references: CanvasReference[]; textPrompt: string };

export const canonicalKind = (kind: string) => kind === 'shot' ? 'video' : kind;
export const canvasKey = (kind: string, id: string) => `${canonicalKind(kind)}:${id}`;

export function buildCanvasContexts(data: {
  assets: Array<{ id: string; kind: string; name: string; imageUrl: string }>;
  referenceNodes: Array<{ id: string; name: string; imageUrl: string }>;
  audioNodes: Array<{ id: string; name: string; audioUrl: string }>;
  textNodes: Array<{ id: string; title: string; content: string }>;
  shots: Array<{ id: string; title: string; videoUrl: string }>;
  links: Array<{ id: string; sourceKind: string; sourceId: string; targetKind: string; targetId: string }>;
}): Record<string, CanvasContext> {
  const sources = new Map<string, { name: string; kind: 'image' | 'video' | 'audio' | 'text'; value: string }>();
  for (const node of data.assets) sources.set(canvasKey(node.kind, node.id), { name: node.name, kind: 'image', value: node.imageUrl });
  for (const node of data.referenceNodes) sources.set(canvasKey('image', node.id), { name: node.name, kind: 'image', value: node.imageUrl });
  for (const node of data.audioNodes) sources.set(canvasKey('audio', node.id), { name: node.name, kind: 'audio', value: node.audioUrl });
  for (const node of data.textNodes) sources.set(canvasKey('text', node.id), { name: node.title, kind: 'text', value: node.content });
  for (const node of data.shots) sources.set(canvasKey('video', node.id), { name: node.title, kind: 'video', value: node.videoUrl });
  const contexts: Record<string, CanvasContext> = {};
  for (const key of sources.keys()) contexts[key] = { references: [], textPrompt: '' };
  for (const link of data.links) {
    const sourceKey = canvasKey(link.sourceKind, link.sourceId);
    const source = sources.get(sourceKey);
    const context = contexts[canvasKey(link.targetKind, link.targetId)];
    if (!source?.value || !context) continue;
    if (source.kind === 'text') {
      context.textPrompt = [context.textPrompt, source.value].filter(Boolean).join('\n\n');
    } else if (!context.references.some(reference => reference.sourceKey === sourceKey)) {
      const number = context.references.filter(reference => reference.kind === source.kind).length + 1;
      const label = { image: '图片', video: '视频', audio: '音色' }[source.kind];
      context.references.push({ id: link.id, sourceKey, kind: source.kind, token: `@${label}${number}`, name: source.name, url: source.value });
    }
  }
  return contexts;
}

export function selectCanvasReferences(prompt: string, references: CanvasReference[]) {
  const tokens = new Set(prompt.match(/@(图片|视频|音色)\d+/g) || []);
  const available = new Set(references.map(reference => reference.token));
  for (const token of tokens) if (!available.has(token)) throw new Error(`${token} 对应素材已断开或没有可用产物`);
  return references.filter(reference => tokens.has(reference.token));
}
