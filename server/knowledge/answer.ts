import type { KnowledgeChunk } from './retriever';

export type EvidenceMode = 'references_available' | 'general_only' | 'clarify';
export function evidenceMode(found: KnowledgeChunk[], conflict = false): EvidenceMode {
  // 命中不等于资料充分，也不等于诊断正确。
  return conflict ? 'clarify' : found.length ? 'references_available' : 'general_only';
}

export function renderDiagnosis(raw: string, found: KnowledgeChunk[], mode: EvidenceMode): string {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const data = JSON.parse(text);
  const list = (value: unknown, max = 6): string[] => {
    if (!Array.isArray(value) || value.length > max || value.some(x => typeof x !== 'string' || !x.trim() || x.length > 1500)) throw new Error('Invalid answer list');
    return value;
  };
  if (!data || typeof data !== 'object' || typeof data.summary !== 'string' || data.summary.length > 1500) throw new Error('Invalid summary');
  if (!Array.isArray(data.evidence) || data.evidence.length > 6) throw new Error('Invalid evidence');
  // 转义模型文本，防止它插入新标题、链接或伪造另一层“资料依据”。
  const plain = (s: string) => s.replace(/[\r\n]+/g, ' ').replace(/([\\`*_{}[\]<>()#+.!|~-])/g, '\\$1');
  const evidence = data.evidence.map((item: { claim: string; sourceIds: number[] }) => {
    if (!item || typeof item.claim !== 'string' || !item.claim.trim() || item.claim.length > 1500 || !Array.isArray(item.sourceIds) || !item.sourceIds.length || item.sourceIds.length > 6 || item.sourceIds.some(id => !Number.isInteger(id) || id < 1 || id > found.length)) throw new Error('Invalid citation');
    return `- ${plain(item.claim)}（资料 ${[...new Set(item.sourceIds)].join('、')}）`;
  });
  if (mode !== 'references_available' && evidence.length) throw new Error('Evidence not allowed');
  const hypotheses = list(data.hypotheses);
  const questions = list(data.questions, 2);
  const checks = list(data.checks);
  if (mode === 'clarify' && !questions.length) throw new Error('Clarification required');
  const bullets = (items: string[]) => items.length ? items.map(s => `- ${plain(s)}`).join('\n') : '暂无。';
  const sources = found.map((c, i) => `- 资料 ${i + 1}：${plain(c.source)} / ${plain(c.heading)}${c.metadata?.sourceUrl ? ` — ${plain(c.metadata.sourceUrl)}` : ''}`).join('\n');
  return [
    mode === 'clarify' ? '**【机型信息待确认】** 当前信息存在冲突，请先确认品牌和型号。' : mode === 'general_only' ? '**【资料状态】** 未检索到适用的本地资料，以下仅为模型待验证分析。' : '**【资料状态】** 已找到候选资料；检索命中不代表已确诊，需核对适用条件。',
    `**【问题概述】** ${plain(data.summary)}`,
    `**【本地资料依据】**\n${evidence.length ? evidence.join('\n') : '本次没有可直接支持判断的资料结论。'}`,
    `**【模型补充分析·待验证】**\n${bullets(hypotheses)}`,
    `**【需要你补充】**\n${bullets(questions)}`,
    `**【建议检查·需核实】**\n${bullets(checks)}`,
    sources ? `**【本次检索资料】**\n${sources}` : '',
    '**【使用边界】** 模型分析不是已确认的故障结论；具体参数和维修操作需核对该机型手册，危险操作交由专业人员处理。',
  ].filter(Boolean).join('\n\n');
}
