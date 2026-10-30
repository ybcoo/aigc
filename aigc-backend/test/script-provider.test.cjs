const assert = require('node:assert/strict');
const { test } = require('node:test');
const { resolve } = require('node:path');
const build = path => require(resolve(__dirname, process.env.AIGC_SCRIPT_TEST_BUILD || '../dist', path));
const { GenerationProvider } = build('src/generation/generation.provider');
const { parseExtractedAssets, extractionPrompt, extractionSystemPrompt } = build('src/script/script.extraction');

test('extraction validates actual declared categories, including missing classification and empty lists', () => {
  for (const expected of ['character','scene','prop']) {
    for (const actual of ['character','scene','prop']) {
      const raw = JSON.stringify({assets:[{kind:actual,name:'Entity'}]});
      if (expected === actual) assert.equal(parseExtractedAssets(raw,expected)[0].name,'Entity');
      else assert.throws(()=>parseExtractedAssets(raw,expected),/分类|条目/);
    }
    assert.throws(()=>parseExtractedAssets('{"assets":[{"name":"Unclassified"}]}',expected),/缺少分类/);
    assert.deepEqual(parseExtractedAssets('{"assets":[]}',expected),[]);
  }
  assert.equal(parseExtractedAssets('{"assets":[{"kind":"location","name":"早餐铺"}]}','scene')[0].name,'早餐铺');
  assert.throws(()=>parseExtractedAssets('{"assets":[{"kind":"scene","name":"早餐铺"},{"kind":"prop","name":"背包"}]}','scene'));
});

test('category-specific rules isolate scenes from characters and props without fixed genre heuristics', () => {
  assert.match(extractionSystemPrompt('scene'),/不提取人物、神兽、食物、背包/);
  assert.match(extractionSystemPrompt('character'),/非人角色/);
  assert.match(extractionSystemPrompt('prop'),/主产品|产品/);
  const prompt=extractionPrompt('scene','原剧本内容',[],{genre:'用户自定义奇幻时代',style:'黏土定格动画'});
  assert.match(prompt,/用户自定义奇幻时代/);assert.match(prompt,/黏土定格动画/);assert.match(prompt,/<original_script>/);
});

test('OpenAI-compatible and Gemini requests keep extraction rules separate from script data', async () => {
  const originalFetch=globalThis.fetch, requests=[];
  globalThis.fetch=async(url,options)=>{
    const body=JSON.parse(options.body);requests.push(body);
    return String(url).includes('generateContent')?Response.json({candidates:[{content:{parts:[{text:'{"assets":[]}'}]}}]}):Response.json({choices:[{message:{content:'{"assets":[]}'}}]});
  };
  try {
    const provider=new GenerationProvider({});
    const systemPrompt=extractionSystemPrompt('scene'),prompt=extractionPrompt('scene','秦宇在早餐铺吃饭。',[],{genre:'玄幻',style:'动漫'});
    const input={kind:'text',model:'mock-text',prompt,systemPrompt,references:[],aspectRatio:'1:1',duration:5,resolution:'480p'};
    for (const apiProtocol of ['openai','gemini']) {
      const config={apiProtocol,baseUrl:'https://provider.example.invalid',apiKey:'test'};
      assert.equal((await provider.generate(config,input,AbortSignal.timeout(5000))).content,'{"assets":[]}');
      const body=requests.at(-1);
      if(apiProtocol==='openai')assert.deepEqual(body.messages,[{role:'system',content:systemPrompt},{role:'user',content:prompt}]);
      else {assert.equal(body.systemInstruction.parts[0].text,systemPrompt);assert.equal(body.contents[0].parts[0].text,prompt)}
    }
    await provider.generate({apiProtocol:'openai',baseUrl:'https://provider.example.invalid',apiKey:'test'},{...input,systemPrompt:undefined},AbortSignal.timeout(5000));
    assert.deepEqual(requests.at(-1).messages,[{role:'user',content:prompt}]);
  } finally {globalThis.fetch=originalFetch}
});
