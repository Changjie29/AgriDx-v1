import type { KnowledgeChunk } from './retriever';

/** 无模型参与；只展示资料定位，避免把未审核维修原文当成诊断结论。 */
export function localFallback(found: KnowledgeChunk[]): string {
  const intro = '**【服务状态】** 智能分析暂不可用，以下是本地检索结果，尚未形成诊断结论。';
  if (!found.length) return `${intro}\n\n**【当前资料不足】** 未找到适用的相关资料。请补充品牌、型号、故障现象和故障码；恢复服务后可重试。`;
  return `${intro}\n\n**【相关资料】**\n${found.map((c, i) => `${i + 1}. ${c.heading}\n   来源：${c.source}${c.metadata?.sourceUrl ? `\n   原文：${c.metadata.sourceUrl}` : ''}`).join('\n\n')}\n\n**【适用范围】** 通用资料仅供初步参考，具体参数和维修操作应核对该机型手册。请补充品牌、型号和发生工况。`;
}
