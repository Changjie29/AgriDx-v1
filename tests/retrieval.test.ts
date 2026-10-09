import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadKnowledgeBase, retrieve } from '../server/knowledge/retriever';
import { buildRetrievalContext } from '../server/knowledge/context';
import { buildSystemPrompt } from '../server/knowledge/systemPrompt';
import { localFallback } from '../server/knowledge/fallback';

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
