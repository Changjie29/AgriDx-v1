/**
 * SRT27 HTTP 服务构建
 *
 * 职责：
 * - Express 中间件（请求 ID、结构化日志、CORS、安全头、JSON 解析、限流）
 * - /api/health、/api/version、/api/knowledge、/api/logs
 * - /api/chat：输入校验 → RAG → LLM Router → 统一错误响应
 * - /api/model/tractor：本地 GLB 文件
 *
 * 注意：
 * - API Key 仅从环境变量读取，绝不打印、绝不返回前端。
 * - 用户侧错误信息永远是友好的中文/英文提示，不暴露 ECONNRESET/502 等技术细节。
 * - 所有日志经 server/logger.ts 输出，落盘与回显前统一脱敏。
 * - 本模块**不监听端口**：监听由 server/main.ts（生产入口）、dev.ts 或测试显式完成。
 *   这样测试 import 本模块不会被强行绑定到 8787，也避免依赖 NODE_ENV 时序。
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createLogger, recentLogs, loggerStatus, type LogLevel } from './logger.js';
import { getAppVersion } from './version.js';

// 1) 必须先加载 server/.env，再读取任何代理/Key 环境变量。
//    这样即使 HTTPS_PROXY 等代理配置写在 .env 里，也能被后续 detectProxy() 正确识别。
dotenv.config({ path: path.resolve(process.cwd(), 'server/.env') });

// 2) Node fetch 默认不走系统代理；若配置了代理，全局启用（undici）。
//    此时 process.env.HTTPS_PROXY 等已包含 .env 中的值。
import { setGlobalDispatcher, ProxyAgent } from 'undici';

const log = createLogger('server');

const proxyUrl =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy;
if (proxyUrl) {
  // 只报告"是否启用"，不打印代理地址（可能含账号密码）
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  log.info('出站代理已启用');
}

// ---- 知识库 & LLM ----
import { loadKnowledgeBase, stats as kbStats, indexedSources } from './knowledge/retriever.js';
import { buildRetrievalContext } from './knowledge/context.js';
import { renderDiagnosis } from './knowledge/answer.js';
import { localFallback } from './knowledge/fallback.js';
import { buildSystemPrompt } from './knowledge/systemPrompt.js';
import { getLlmRouter } from './llm/router.js';
import { ProviderError, type ChatMessage } from './llm/types.js';

loadKnowledgeBase();
const llm = getLlmRouter();

const app = express();
const PORT = Number(process.env.PORT) || 8787;

// 版本与进程启动时间：/api/version 与 /api/health 都从这里取，保证同一进程内自洽
const VERSION = getAppVersion();
const BOOTED_AT = new Date().toISOString();

// ---- 基础安全 ----
app.set('trust proxy', 1);
app.disable('x-powered-by');

// ---- 请求 ID + 访问日志 ----
// 每个请求一个 ID：错误响应体与响应头都会带上，便于把用户反馈对应到日志。
// 用 `& { requestId?: string }` 扩展而不是全局 declare module，避免污染 express 的类型。
type RequestWithId = Request & { requestId?: string };

app.use((req: Request, res: Response, next: NextFunction) => {
  const withId = req as RequestWithId;
  const incoming = req.get('x-request-id');
  const requestId = incoming && /^[A-Za-z0-9_-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  withId.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const line = {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
    };
    // 4xx/5xx 归为 warn/error，便于按级别筛选异常流量
    if (res.statusCode >= 500) log.error('请求处理失败', { requestId, detail: line });
    else if (res.statusCode >= 400) log.warn('请求被拒绝', { requestId, detail: line });
    else log.info('请求完成', { requestId, detail: line });
  });

  next();
});

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

const ALLOWED_ORIGINS = new Set([
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : []),
]);
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || ALLOWED_ORIGINS.has(origin)) return cb(null, true);
      cb(new Error('CORS blocked'));
    },
  }),
);

app.use(express.json({ limit: '256kb' }));

// ---- 限流：每 IP 每分钟 30 次 /api/chat ----
const rateBucket = new Map<string, { count: number; reset: number }>();
app.use('/api/chat', (req, res, next) => {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const bucket = rateBucket.get(ip);
  if (!bucket || bucket.reset < now) {
    rateBucket.set(ip, { count: 1, reset: now + 60_000 });
  } else {
    bucket.count++;
    if (bucket.count > 30) {
      res.status(429).json({ error: '请求过于频繁，请稍后再试', code: 'rate_limited' });
      return;
    }
  }
  next();
});

// ---- 健康检查 ----
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    version: VERSION.version,
    knowledge: kbStats(),
  });
});

// ---- 版本信息 ----
// 版本号唯一来源是 package.json，运行时读取，因此不会与更新日志/发布标签漂移。
app.get('/api/version', (_req: Request, res: Response) => {
  res.json({
    ...VERSION,
    startedAt: BOOTED_AT,
    uptimeSeconds: Math.round(process.uptime()),
    knowledge: kbStats(),
  });
});

// ---- 知识库自检：哪份资料生效、哪份被排除 ----
// 排查"资料明明在仓库里却没有被引用"这类问题时，直接看这个接口即可。
app.get('/api/knowledge', (_req: Request, res: Response) => {
  res.json({ ...kbStats(), indexedSources: indexedSources() });
});

// ---- 近期日志（无日志平台时的排查手段）----
app.get('/api/logs', (req: Request, res: Response) => {
  // 仅在本机/内网排查时开放；公网部署请用 ALLOWED_ORIGINS + 反向代理限制
  if (process.env.ENABLE_LOG_ENDPOINT !== 'true') {
    res.status(404).json({ error: '未开启日志接口', code: 'logs_disabled' });
    return;
  }
  const rawLimit = Number(req.query.limit);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 200) : 50;
  const level = typeof req.query.level === 'string' && ['debug', 'info', 'warn', 'error'].includes(req.query.level)
    ? (req.query.level as LogLevel)
    : undefined;
  res.json({ status: loggerStatus(), entries: recentLogs(limit, level) });
});

// ---- /api/chat ----
interface ChatRequestBody {
  messages?: ChatMessage[];
  machineType?: string;
  brand?: string;
  model?: string;
}

app.post('/api/chat', async (req: Request, res: Response) => {
  const body = req.body as ChatRequestBody;
  const { messages, machineType, brand, model } = body || {};
  if ([machineType, brand, model].some(v => v !== undefined && (typeof v !== 'string' || v.length > 100))) {
    res.status(400).json({ error: '机型信息格式错误', code: 'bad_request' });
    return;
  }

  // 输入校验
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'messages 参数缺失或格式错误', code: 'bad_request' });
    return;
  }
  if (messages.length > 40) {
    res.status(400).json({ error: '对话轮次过多，请新开对话', code: 'too_long' });
    return;
  }
  const ROLES = new Set(['system', 'user', 'assistant']);
  for (const m of messages) {
    if (!m || typeof m !== 'object' || !ROLES.has(m.role) || typeof m.content !== 'string') {
      res.status(400).json({ error: '消息格式错误', code: 'bad_request' });
      return;
    }
    if (m.content.length > 2000) {
      res.status(400).json({ error: '单条消息过长（上限 2000 字符）', code: 'too_long' });
      return;
    }
  }

  // 前端不应发送 system；如发送，丢弃（后端拥有最终 system prompt）
  const history = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-20) // 最多保留 20 轮，避免无限增长
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  if (!history.some(m => m.role === 'user')) {
    res.status(400).json({ error: '请提供用户问题', code: 'bad_request' });
    return;
  }
  const context = buildRetrievalContext(history, { machineType, brand, model });
  const { message: systemMsg, retrieved, mode } = buildSystemPrompt(context);
  const sources = retrieved.map((c, i) => ({ id: i + 1, source: c.source, heading: c.heading, ...c.metadata }));

  const fullMessages: ChatMessage[] = [systemMsg, ...history];

  let modelResponded = false;
  try {
    const outcome = await llm.chat(fullMessages);
    modelResponded = true;
    // 返回 OpenAI 兼容结构 + 附加 provider/model/knowledge 元信息
    res.json({
      choices: [{ message: { role: 'assistant', content: renderDiagnosis(outcome.result.content, retrieved, mode) } }],
      model: outcome.result.model,
      provider: outcome.result.provider,
      fellBack: outcome.fellBack,
      knowledgeChunks: retrieved.length,
      sources,
      answerMode: 'model',
      evidenceMode: mode,
    });
  } catch (err) {
    // 两个 provider 都不可用或输出不合格：降级为本地资料检索，日志带 requestId 便于回查
    const requestId = (req as RequestWithId).requestId;
    if (err instanceof ProviderError) {
      log.warn('模型调用失败，降级为本地资料', {
        requestId,
        detail: { provider: err.provider, kind: err.kind },
      });
    } else {
      log.error('模型输出不可用，降级为本地资料', {
        requestId,
        detail: { name: err instanceof Error ? err.name : 'unknown' },
      });
    }
    res.json({
      choices: [{ message: { role: 'assistant', content: localFallback(retrieved, modelResponded ? 'invalid_output' : 'unavailable') } }],
      provider: null, model: '本地资料检索（未生成诊断）', fellBack: true,
      answerMode: 'local', evidenceMode: mode, knowledgeChunks: retrieved.length, sources,
    });
  }
});

// ---- 3D 模型 ----
app.get('/api/model/tractor', (_req: Request, res: Response) => {
  const modelPath = path.resolve(process.cwd(), 'public/models/tractor.glb');
  res.sendFile(modelPath, (err) => {
    if (err) res.status(404).json({ error: '模型文件不存在' });
  });
});

// ---- 全局错误兜底 ----
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  const requestId = (req as RequestWithId).requestId;
  log.error('未处理的服务端异常', { requestId, detail: { name: err.name, message: err.message } });
  res.status(500).json({ error: '服务器内部错误', code: 'internal_error', requestId });
});

export { VERSION, BOOTED_AT };
export default app;
