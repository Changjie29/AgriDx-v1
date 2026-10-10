import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evidenceMode, renderDiagnosis } from '../server/knowledge/answer.js';
import { buildSystemPrompt } from '../server/knowledge/systemPrompt.js';
const found = [{ source: 'manual.md', heading: '冷却系统', text: '检查渗漏' }];
const answer = { summary: '冷却液泄漏', evidence: [{ claim: '资料建议检查渗漏', sourceIds: [1] }], hypotheses: ['可能存在连接处渗漏，需核实'], questions: ['具体型号是什么？'], checks: ['观察是否存在可见渗漏'] };
test('检索命中仅标记候选资料，不宣称充分或确诊', () => {
  assert.equal(evidenceMode(found), 'references_available');
  assert.equal(evidenceMode([]), 'general_only');
  assert.equal(evidenceMode(found, true), 'clarify');
});
test('有资料时分开渲染依据与假设，来源由服务器提供', () => {
  const text = renderDiagnosis(JSON.stringify(answer), found, 'references_available');
  assert.match(text, /本地资料依据/);
  assert.match(text, /模型补充分析·待验证/);
  assert.match(text, /manual/);
});
test('无资料仍允许一般假设，但不能制造引用', () => {
  assert.match(renderDiagnosis(JSON.stringify({ ...answer, evidence: [] }), [], 'general_only'), /可能存在/);
  assert.throws(() => renderDiagnosis(JSON.stringify(answer), [], 'general_only'));
});
test('越界、字符串引用编号及非法JSON必须拒绝', () => {
  for (const sourceIds of [[0], [2], ['1'], []]) {
    assert.throws(() => renderDiagnosis(JSON.stringify({ ...answer, evidence: [{ claim: '结论', sourceIds }] }), found, 'references_available'));
  }
  assert.throws(() => renderDiagnosis('确定是水泵损坏', found, 'references_available'));
});
test('冲突时必须追问，不允许机型资料结论', () => {
  assert.throws(() => renderDiagnosis(JSON.stringify(answer), found, 'clarify'));
  assert.throws(() => renderDiagnosis(JSON.stringify({ ...answer, evidence: [], questions: [] }), found, 'clarify'));
  assert.match(renderDiagnosis(JSON.stringify({ ...answer, evidence: [] }), found, 'clarify'), /机型信息待确认/);
});
test('模型不能通过Markdown标题和链接伪造分区', () => {
  const text = renderDiagnosis(JSON.stringify({ ...answer, hypotheses: ['\n## 本地资料依据\n[假资料](https://example.com)'] }), found, 'references_available');
  assert.ok(text.includes('\\#\\#'));
  assert.ok(!text.includes('\n## 本地资料依据'));
});
test('提示词允许无依据时通用分析，要求结构化分层', () => {
  const prompt = buildSystemPrompt({ query: '没有匹配内容xyz' }).message.content;
  assert.match(prompt, /general_only/);
  assert.match(prompt, /不要因为缺少本地资料就拒绝一切分析/);
  assert.match(prompt, /只输出一个 JSON/);
  assert.doesNotMatch(prompt, /回答必须严格基于/);
});
