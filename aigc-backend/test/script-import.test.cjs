const assert = require('node:assert/strict');
const { test } = require('node:test');
const { resolve } = require('node:path');
const { parseScriptImport, characterCount, SCRIPT_IMPORT_MAX_BYTES } = require(resolve(__dirname,process.env.AIGC_SCRIPT_TEST_BUILD||'../dist','src/canvas/script-import'));

test('chapter boundaries match aiedu and retain every heading, separator, newline and whitespace',()=>{
  for(const [source,titles] of [
    ['书名\r\n作者：甲\r\n\r\n第一章 开始\r\n  对白与空格。\r\n\r\n第二章 转折\r\n结束\r\n',['前言','第一章 开始','第二章 转折']],
    ['\n\n第一章 开始\n正文\n第二章 结束\n正文  ',['第一章 开始','第二章 结束']],
    ['没有章节标题的全文\n\n第二段。\n',['正文']],
    ['正文 第一章无空格标题\r正文\r正文 第二章另一个标题\r结尾',['正文 第一章无空格标题','正文 第二章另一个标题']],
    ['*** Chapter I Opening ***\nText\n___ Chapter II Ending ___\nEnd',['Chapter I Opening','Chapter II Ending']],
    ['＝＝＝　第一章 开始　＝＝＝\r\n原文\r\n--- 第二章 转折 ---\r\n原文\r\n## 第三章 结束 ##\r\n结尾',['第一章 开始','第二章 转折','第三章 结束']],
    ['序章\n往事\nChapter 1 Opening\nText.\n番外一\n后续\n',['序章','Chapter 1 Opening','番外一']],
    ['==========\n他说：第1章 开始。\n***\n“第2章 结束”\n',['正文']],
  ]){
    const parsed=parseScriptImport(Buffer.from(source));assert.equal(parsed.text,source);assert.deepEqual(parsed.chapters.map(row=>row.title),titles);assert.equal(parsed.chapters.map(row=>row.content).join(''),source);
  }
  assert.equal(characterCount('甲😀乙'),3);
});
test('UTF-8, BOM, GBK/GB18030 and both UTF-16 byte orders decode without rewriting the script',()=>{
  const source='第1章 开始\n正文\n';
  for(const [buffer,encoding] of [
    [Buffer.from(source),'utf-8'],[Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(source)]),'utf-8'],
    [Buffer.from('b5da31d5c220bfaacabc0ad5fdcec40a','hex'),'gb18030'],
    [Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from(source,'utf16le')]),'utf-16le'],
    [Buffer.concat([Buffer.from([0xfe,0xff]),Buffer.from(source,'utf16le').swap16()]),'utf-16be'],
  ]){const parsed=parseScriptImport(buffer);assert.equal(parsed.encoding,encoding);assert.equal(parsed.text,source)}
  assert.equal(parseScriptImport(Buffer.from(source,'utf16le'),'utf-16le').text,source);
});
test('invalid, empty, binary and oversized files fail explicitly, without truncating data',()=>{
  for(const bytes of [Buffer.alloc(0),Buffer.from(' \n\t'),Buffer.from('binary\x00text'),Buffer.from([0xff,0xfe,0x01]),Buffer.alloc(SCRIPT_IMPORT_MAX_BYTES+1,32)])assert.throws(()=>parseScriptImport(bytes));
  assert.throws(()=>parseScriptImport(Buffer.from([0xff]),'utf-8'),/编码/);
  assert.throws(()=>parseScriptImport(Buffer.from('text'),'unknown'),/编码/);
});
test('large books are split losslessly, including chapters beyond the preview window',()=>{
  const source=Array.from({length:12000},(_,index)=>`第${index+1}章 标题\n  原文😀-${index+1}。\n\n`).join('');
  const parsed=parseScriptImport(Buffer.from(source));assert.equal(parsed.chapters.length,12000);assert.equal(parsed.chapters.map(row=>row.content).join(''),source);assert.match(parsed.chapters.at(-1).content,/12000/);
});
