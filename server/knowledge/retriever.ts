/**
 * 本地轻量 RAG
 *
 * 设计原则：
 * - 不引入向量库 / ES / Redis / LangChain。
 * - 启动时扫描 server/knowledge/ 下所有 .md 文件，按二级标题切块。
 * - 查询时用关键词重叠打分（中文 bigram + 英文 token），取 top-K 片段。
 * - 知识库很小，全量塞 prompt 也可；这里做"按需选片"，为未来扩充留接口。
 * - 未来接入 PDF/Word 时，只需在 loadAll() 里加新解析器，返回 {path, heading, text}。
 */
import fs from 'node:fs';
import path from 'node:path';

export interface MachineScope { machineType?: string; brand?: string; model?: string; conflict?: boolean }
export interface KnowledgeMetadata { machineType: string; brand?: string; models?: string[]; enabled: boolean; sourceUrl?: string }

export interface KnowledgeChunk {
  metadata?: KnowledgeMetadata;
  /** 文件相对 server/knowledge 的路径 */
  source: string;
  /** 该块所属章节标题（## 级） */
  heading: string;
  /** 块正文 */
  text: string;
}

interface ScoredChunk extends KnowledgeChunk {
  score: number;
}

const KB_ROOT = path.resolve(process.cwd(), 'server/knowledge');
const MAX_CHUNKS_IN_PROMPT = 6;
const MAX_CHARS_PER_CHUNK = 1200;

// ---- 启动时索引 ----
let chunks: KnowledgeChunk[] = [];

function walkMdFiles(dir: string, base: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = path.join(base, e.name);
    if (e.isDirectory()) {
      out.push(...walkMdFiles(full, rel));
    } else if (e.isFile() && e.name.endsWith('.md')) {
      out.push(rel);
    }
  }
  return out;
}

function splitByHeading(relPath: string, content: string): KnowledgeChunk[] {
  const out: KnowledgeChunk[] = [];
  // 按 ## 切；文件首个 # 标题作为文件头，保留为 meta
  const lines = content.split(/\r?\n/);
  let currentHeading = '(概述)';
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join('\n').trim();
    if (text.length > 0) {
      out.push({ source: relPath, heading: currentHeading, text });
    }
    buf = [];
  };
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      flush();
      currentHeading = line.replace(/^##\s+/, '').trim();
    } else {
      buf.push(line);
    }
  }
  flush();
  return out;
}

export function loadKnowledgeBase(): { fileCount: number; chunkCount: number } {
  chunks = [];
  let fileCount = 0;
  try {
    const files = walkMdFiles(KB_ROOT, '');
    for (const rel of files) {
      // 跳过说明性 README（00_说明 下的 README 不参与检索）
      if (rel.replace(/\\/g, '/').startsWith('00_说明/')) continue;
      const abs = path.join(KB_ROOT, rel);
      const content = fs.readFileSync(abs, 'utf-8');
      const match = content.match(/<!-- agridx-meta: (.+) -->/);
      // 未标明适用范围的资料保留在磁盘，审核并添加元信息后才参与回答。
      if (!match) continue;
      let metadata: KnowledgeMetadata;
      try { metadata = JSON.parse(match[1]) as KnowledgeMetadata; }
      catch { console.warn(`[kb] invalid metadata: ${rel}`); continue; }
      if (!metadata || (metadata.brand !== undefined && typeof metadata.brand !== 'string') ||
          (metadata.models !== undefined && (!Array.isArray(metadata.models) || !metadata.models.every(m => typeof m === 'string'))) ||
          (metadata.sourceUrl !== undefined && typeof metadata.sourceUrl !== 'string')) continue;
      if (metadata.enabled !== true || typeof metadata.machineType !== 'string') continue;
      chunks.push(...splitByHeading(rel, content.replace(match[0], '')).filter(c => c.heading !== '(概述)').map(c => ({ ...c, metadata })));
      fileCount++;
    }
  } catch (e) {
    console.warn('[kb] load failed:', (e as Error).message);
  }
  console.log(`[kb] loaded ${fileCount} files, ${chunks.length} chunks from ${KB_ROOT}`);
  return { fileCount, chunkCount: chunks.length };
}

// ---- 关键词打分 ----

function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  // 英文/数字 token
  const enTokens = lower.match(/[a-z0-9]{2,}/g) || [];
  // 中文按 2-gram
  const zhChars = (lower.match(/[\u4e00-\u9fa5]/g) || []).join('');
  const zhBigrams: string[] = [];
  for (let i = 0; i < zhChars.length - 1; i++) {
    zhBigrams.push(zhChars.slice(i, i + 2));
  }
  return [...enTokens, ...zhBigrams];
}

function scoreChunk(chunk: KnowledgeChunk, queryTokens: Set<string>): number {
  const haystack = (chunk.heading + '\n' + chunk.text).toLowerCase();
  let score = 0;
  for (const t of queryTokens) {
    if (haystack.includes(t)) {
      // 标题命中权重更高
      score += chunk.heading.toLowerCase().includes(t) ? 3 : 1;
    }
  }
  return score;
}

/**
 * 根据用户问题检索最相关的知识片段。
 * 无命中时返回空数组，调用方决定 fallback。
 */
export function retrieve(query: string, k = MAX_CHUNKS_IN_PROMPT, scope: MachineScope = {}): KnowledgeChunk[] {
  if (chunks.length === 0) return [];
  const qTokens = new Set(tokenize(query));
  if (qTokens.size === 0) return [];

  const scored: ScoredChunk[] = [];
  for (const c of chunks) {
    const meta = c.metadata;
    if (!meta) continue;
    const norm = (v: string) => v.toLowerCase().replace(/[\s-]/g, '');
    if (scope.machineType && norm(scope.machineType) !== norm(meta.machineType)) continue;
    if (meta.brand || meta.models?.length) {
      if (scope.conflict) continue;
      if (meta.brand && (!scope.brand || norm(meta.brand) !== norm(scope.brand))) continue;
      if (meta.models?.length && (!scope.model || !meta.models.some(m => norm(m) === norm(scope.model!)))) continue;
    }
    const s = scoreChunk(c, qTokens);
    if (s > 0) scored.push({ ...c, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map(({ source, heading, text, metadata }) => ({ source, heading, text, metadata }));
}

/** 当前知识条目数（供 /api/health 或前端展示） */
export function stats() {
  return { chunks: chunks.length };
}

/** 把命中的片段格式化为注入 system prompt 的文本块 */
export function formatForPrompt(found: KnowledgeChunk[]): string {
  if (found.length === 0) return '';
  return found
    .map((c, i) => {
      const body = c.text.length > MAX_CHARS_PER_CHUNK ? c.text.slice(0, MAX_CHARS_PER_CHUNK) + '…' : c.text;
      return `【片段 ${i + 1}｜来源：${c.source}｜章节：${c.heading}｜适用：${c.metadata?.brand || "通用"} ${c.metadata?.models?.join("、") || c.metadata?.machineType || "未指定"}｜原文：${c.metadata?.sourceUrl || "未记录"}】\n${body}`;
    })
    .join('\n\n---\n\n');
}
