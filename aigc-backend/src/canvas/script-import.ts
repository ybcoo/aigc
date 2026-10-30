import { BadRequestException } from '@nestjs/common';

export const SCRIPT_IMPORT_MAX_BYTES = 32 * 1024 * 1024;
export const SCRIPT_IMPORT_MAX_EPISODES = 100000;
const heading = /^(?:正文\s+)?(?:第[零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟0-9０-９]+[章回节集].*|chapter\s+[0-9ivxlcdm]+(?:\s|[.:：-]|$).*|(?:序章|楔子|前言|引子|尾声|后记|番外)(?:\s|[：:、.．0-9一二三四五六七八九十]|$).*)$/i;

export type ImportedChapter = { title: string; content: string };
export type ScriptImportPreview = { title: string; encoding: string; chapterCount: number; characterCount: number; chapters: Array<{ episodeNumber: number; title: string; characterCount: number }> };
export function characterCount(text: string) { let count = 0; for (const _character of text) count++; return count; }

export function parseScriptImport(bytes: Uint8Array, encoding = 'auto') {
  if (!bytes.length || bytes.length > SCRIPT_IMPORT_MAX_BYTES) throw new BadRequestException('请选择不超过 32MB 的非空 TXT 文件');
  let text: string;
  if (!encoding || encoding === 'auto') {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
    else {
      try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); encoding = 'utf-8'; }
      catch { encoding = 'gb18030'; }
    }
  }
  if (!['utf-8', 'gb18030', 'utf-16le', 'utf-16be'].includes(encoding)) throw new BadRequestException('不支持的文本编码');
  if (encoding.startsWith('utf-16')) {
    if (bytes.length % 2) throw new BadRequestException('UTF-16 文件不完整，请检查文件或切换编码');
    if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
    if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
  }
  try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''); }
  catch { throw new BadRequestException('无法按所选编码读取文件，请切换编码后重试'); }
  if (!text.trim()) throw new BadRequestException('TXT 文件没有正文');
  if (/[\u0000-\u0008\u000b\u000e-\u001f\u007f-\u009f]/u.test(text)) throw new BadRequestException('文件包含非文本内容，请上传纯文本 TXT');
  const boundaries: Array<{ start: number; title: string }> = [];
  for (const line of text.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
    if (!line[0]) break;
    const title = line[0].replace(/^[\s=＝\-－—─━_*＊#＃~～]+|[\s=＝\-－—─━_*＊#＃~～]+$/gu, '');
    if (characterCount(title) <= 200 && heading.test(title)) {
      boundaries.push({ start: line.index, title });
      if (boundaries.length > SCRIPT_IMPORT_MAX_EPISODES) throw new BadRequestException('章节数量超过 100000，请分卷导入');
    }
  }
  const chapters: ImportedChapter[] = [];
  if (!boundaries.length) chapters.push({ title: '正文', content: text });
  else {
    if (boundaries[0].start > 0) {
      const prefix = text.slice(0, boundaries[0].start);
      if (prefix.trim()) chapters.push({ title: '前言', content: prefix });
      else boundaries[0].start = 0;
    }
    for (const [index, boundary] of boundaries.entries()) {
      chapters.push({ title: boundary.title, content: text.slice(boundary.start, boundaries[index + 1]?.start ?? text.length) });
    }
  }
  if (chapters.length > SCRIPT_IMPORT_MAX_EPISODES) throw new BadRequestException('章节数量超过 100000，请分卷导入');
  return { encoding, text, chapters };
}
