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
import { createLogger } from '../logger.js';

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

const log = createLogger('kb');

/** 知识库根目录；允许用 KB_ROOT 覆盖，便于测试与非常规部署 */
function kbRoot(): string {
  return process.env.KB_ROOT
    ? path.resolve(process.env.KB_ROOT)
    : path.resolve(process.cwd(), 'server/knowledge');
}

const MAX_CHUNKS_IN_PROMPT = 6;
const MAX_CHARS_PER_CHUNK = 1200;

// ---- 启动时索引 ----
let chunks: KnowledgeChunk[] = [];

/** 上一次 loadKnowledgeBase() 的统计，供 /api/health 与 /api/version 暴露 */
let lastStats: KnowledgeStats = {
  fileCount: 0,
  chunkCount: 0,
  scannedFiles: 0,
  skippedDisabled: 0,
  skippedNoMetadata: 0,
  skippedInvalidMetadata: 0,
  root: '',
  warnings: [],
};

export interface KnowledgeStats {
  /** 实际参与检索的文件数 */
  fileCount: number;
  /** 实际参与检索的知识片段数 */
  chunkCount: number;
  /** 磁盘上扫描到的 .md 文件总数 */
  scannedFiles: number;
  /** 因 enabled !== true 被排除的文件数 */
  skippedDisabled: number;
  /** 因缺少 agridx-meta 被排除的文件数 */
  skippedNoMetadata: number;
  /** 因元信息非法被排除的文件数 */
  skippedInvalidMetadata: number;
  /** 知识库根目录绝对路径 */
  root: string;
  /** 需要维护者处理的问题（例如"有文件但全部未启用"） */
  warnings: string[];
}

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

export function loadKnowledgeBase(): KnowledgeStats {
  chunks = [];
  const root = kbRoot();
  let fileCount = 0;
  let skippedDisabled = 0;
  let skippedNoMetadata = 0;
  let skippedInvalidMetadata = 0;
  const warnings: string[] = [];

  let files: string[] = [];
  try {
    files = walkMdFiles(root, '');
  } catch (e) {
    log.error('知识库目录读取失败', { detail: { root, error: (e as Error).message } });
    warnings.push(`知识库目录不可读：${root}`);
  }
  if (files.length === 0) {
    // 明确报错，而不是静默降级为"无资料"——空知识库会让所有回答都变成通用分析
    log.error('知识库为空，未扫描到任何 .md 文件', { detail: { root } });
    warnings.push(`未扫描到任何 .md 文件：${root}`);
  }

  for (const rel of files) {
    const norm = rel.split(path.sep).join('/');
    // 跳过说明性 README（00_说明 下的 README 不参与检索）
    if (norm.startsWith('00_说明/')) continue;
    let content: string;
    try {
      content = fs.readFileSync(path.join(root, rel), 'utf-8');
    } catch (e) {
      log.warn('资料读取失败，已跳过', { detail: { file: norm, error: (e as Error).message } });
      skippedInvalidMetadata++;
      continue;
    }
    const match = content.match(/<!-- agridx-meta: (.+) -->/);
    // 未标明适用范围的资料保留在磁盘，审核并添加元信息后才参与回答。
    if (!match) {
      skippedNoMetadata++;
      continue;
    }
    let metadata: KnowledgeMetadata;
    try {
      metadata = JSON.parse(match[1]) as KnowledgeMetadata;
    } catch {
      log.warn('元信息不是合法 JSON，已跳过', { detail: { file: norm } });
      skippedInvalidMetadata++;
      continue;
    }
    const metaValid =
      metadata !== null &&
      typeof metadata === 'object' &&
      (metadata.brand === undefined || typeof metadata.brand === 'string') &&
      (metadata.models === undefined || (Array.isArray(metadata.models) && metadata.models.every((m) => typeof m === 'string'))) &&
      (metadata.sourceUrl === undefined || typeof metadata.sourceUrl === 'string') &&
      typeof metadata.machineType === 'string';
    if (!metaValid) {
      log.warn('元信息字段不合法，已跳过', { detail: { file: norm } });
      skippedInvalidMetadata++;
      continue;
    }
    if (metadata.enabled !== true) {
      skippedDisabled++;
      continue;
    }
    const parts = splitByHeading(rel, content.replace(match[0], '')).filter((c) => c.heading !== '(概述)');
    if (parts.length === 0) {
      // 启用了但没有 ## 章节：几乎肯定是格式问题，明确告警
      log.warn('资料已启用但没有 ## 章节，未索引任何片段', { detail: { file: norm } });
      warnings.push(`已启用但无 ## 章节：${norm}`);
      continue;
    }
    chunks.push(...parts.map((c) => ({ ...c, metadata })));
    fileCount++;
  }

  if (files.length > 0 && fileCount === 0) {
    warnings.push('所有资料都被排除（未启用或缺元信息），检索将始终返回"无资料"');
  }
  if (skippedNoMetadata > 0) {
    warnings.push(`${skippedNoMetadata} 份资料缺少 <!-- agridx-meta --> 元信息，未参与检索`);
  }
  if (skippedDisabled > 0) {
    warnings.push(`${skippedDisabled} 份资料 enabled=false，未参与检索`);
  }

  lastStats = {
    fileCount,
    chunkCount: chunks.length,
    scannedFiles: files.length,
    skippedDisabled,
    skippedNoMetadata,
    skippedInvalidMetadata,
    root,
    warnings,
  };

  log.info('知识库索引完成', {
    detail: {
      root,
      files: files.length,
      indexed: fileCount,
      chunks: chunks.length,
      skippedNoMetadata,
      skippedDisabled,
      skippedInvalidMetadata,
    },
  });
  for (const warning of warnings) log.warn(warning);

  return lastStats;
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

/** 当前知识库统计（供 /api/health、/api/version 与前端展示） */
export function stats(): KnowledgeStats {
  return { ...lastStats, chunkCount: chunks.length };
}

/** 已参与索引的文件相对路径（排查"哪份资料没生效"用） */
export function indexedSources(): string[] {
  return [...new Set(chunks.map((c) => c.source))].sort();
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
