import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadKnowledgeBase, retrieve } from '../server/knowledge/retriever.js';
import { buildRetrievalContext } from '../server/knowledge/context.js';
import { buildSystemPrompt } from '../server/knowledge/systemPrompt.js';
import { localFallback } from '../server/knowledge/fallback.js';

loadKnowledgeBase();
test('补充型号后保留原症状，不使用助手推测检索', () => {
  const c = buildRetrievalContext([{ role: 'user', content: '拖拉机冷却液泄漏' }, { role: 'assistant', content: '可能是油泵' }, { role: 'user', content: '型号是9R，约翰迪尔' }], {});
  assert.match(c.query, /冷却液泄漏/);
  assert.doesNotMatch(c.query, /油泵/);
  assert.equal(c.model, '9R');
  assert.ok(buildSystemPrompt(c).retrieved.some(x => /冷却/.test(x.heading)));
});
test('未知型号与其他品牌不能检索9R专用故障码', () => {
  for (const scope of [{}, { brand: '雷沃', model: '9R' }, { brand: '约翰迪尔', model: '8R' }]) {
    assert.ok(retrieve('ECU 000110.00 冷却液温度高', 6, scope).every(c => !c.metadata?.models?.length));
  }
});
test('明确约翰迪尔9R才能使用对应故障码', () => {
  assert.ok(retrieve('ECU 000110.00 冷却液温度高', 6, { brand: '约翰迪尔', model: '9R' }).some(c => c.metadata?.models?.includes('9R')));
});
test('整理后的两类资料保持可检索的相对来源路径和原文网址', () => {
  const general = retrieve('散热器冷却液', 6, { machineType: '拖拉机' });
  const generalSource = '02_农机类型/拖拉机检修与常见故障.md';
  const generalChunk = general.find(c => c.source === generalSource);
  assert.ok(generalChunk, '通用检修资料应从分类目录加载');
  assert.equal(generalChunk.metadata?.sourceUrl, 'http://www.amic.agri.cn/secondLevelPage/info/30/204267');
  assert.ok(localFallback(general).includes(generalSource));

  const specialized = retrieve('ECU 000110.00 冷却液温度高', 6, { machineType: '拖拉机', brand: '约翰迪尔', model: '9R' });
  const specializedSource = '05_故障代码/约翰迪尔9R-诊断故障码.md';
  const specializedChunk = specialized.find(c => c.source === specializedSource);
  assert.ok(specializedChunk, '9R 故障码资料应从故障代码目录加载');
  assert.equal(specializedChunk.metadata?.sourceUrl, 'https://www.camda.cn/message/2017/31971.html');
  assert.deepEqual(specializedChunk.metadata?.models, ['9R']);

  for (const chunk of [...general, ...specialized]) {
    assert.ok(!chunk.source.includes('\\'), '来源路径在各平台统一使用 /');
    assert.ok(!chunk.source.includes('server/knowledge/'), '来源路径相对知识库根目录');
  }
});
test('选择器与用户文本冲突时排除专用资料', () => {
  const c = buildRetrievalContext([{ role: 'user', content: '雷沃冷却液高温，型号是8R' }], { brand: '约翰迪尔', model: '9R' });
  assert.equal(c.conflict, true);
  assert.ok(buildSystemPrompt(c).retrieved.every(x => !x.metadata?.models?.length));
});
test('明确新问题重置旧症状', () => {
  const c = buildRetrievalContext([{ role: 'user', content: '冷却液泄漏' }, { role: 'user', content: '换个问题，启动困难' }], {});
  assert.doesNotMatch(c.query, /泄漏/);
});
test('示例资料被排除，无关问题无命中', () => {
  assert.ok(retrieve('水温 82 保养 100').every(c => !c.source.endsWith('通用故障诊断.md')));
  assert.deepEqual(retrieve('xyzqwerty'), []);
});
test('本地兜底明确标记，包含实际来源', () => {
  assert.match(localFallback([]), /未找到适用/);
  const found = retrieve('散热器冷却液');
  assert.ok(found.length);
  assert.match(localFallback(found), /尚未形成诊断结论/);
  assert.ok(localFallback(found).includes(found[0].source));
});
