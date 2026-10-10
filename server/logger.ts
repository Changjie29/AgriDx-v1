/**
 * 结构化日志
 *
 * 设计原则：
 * - 单一出口：所有日志经 logger 输出，便于统一脱敏与落盘。
 * - 默认脱敏：API Key、Bearer token、`key=value` 形式的密钥一律替换为 [redacted]，
 *   避免排查问题时把密钥写进日志或工单。
 * - 双格式：`LOG_FORMAT=json` 输出单行 JSON（便于采集），默认输出可读文本。
 * - 内存环形缓冲：保留最近 N 条，供 `/api/logs` 在无日志平台时排查。
 * - 可选落盘：设置 `LOG_FILE` 后追加写入 JSONL，并按 `LOG_MAX_BYTES` 轮转为 `.1`。
 *
 * 本模块不依赖任何其他 server 模块，避免循环依赖。
 */
import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogEntry {
  time: string;
  level: LogLevel;
  scope: string;
  message: string;
  requestId?: string;
  detail?: unknown;
}

export interface LogFields {
  requestId?: string;
  detail?: unknown;
}

// ---- 配置 ----

function resolveLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL || '').trim().toLowerCase();
  if (raw && raw in LEVEL_WEIGHT) return raw as LogLevel;
  // 测试环境默认静默，避免污染测试输出
  if (process.env.NODE_ENV === 'test') return 'error';
  return 'info';
}

let threshold = LEVEL_WEIGHT[resolveLevel()];
const format: 'text' | 'json' = (process.env.LOG_FORMAT || '').trim().toLowerCase() === 'json' ? 'json' : 'text';
const RING_SIZE = 200;
const ring: LogEntry[] = [];

const logFile = (process.env.LOG_FILE || '').trim();
const maxBytes = Number(process.env.LOG_MAX_BYTES) || 2 * 1024 * 1024;
let writtenBytes = 0;

// ---- 脱敏 ----

/**
 * 敏感字段名。对象脱敏时按"字段名"判断，因此 `{ token: "..." }`
 * 这类没有 `=` / `:` 包裹的场景也能被识别。
 */
const SENSITIVE_KEY = /(api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|secret|token|authorization|credential)/i;

/**
 * 敏感值模式，用于纯文本（日志正文、错误消息）里的兜底脱敏。
 *
 * 每个模式自带一个 replacer，避免用"回调参数下标"去猜分组——
 * 那种写法极易把 `p1` 与 `match` 搞混，导致密钥没被真正替换掉。
 * 回调签名固定为：(match, p1, p2, …)。
 */
const SECRET_PATTERNS: { pattern: RegExp; replace: (...args: string[]) => string }[] = [
  {
    // sk-xxxx / gsk_xxx / AIzaXXXX / xai-xxx 等常见前缀
    pattern: /\b(?:sk-[A-Za-z0-9_-]{8,}|gsk_[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{10,}|xai-[A-Za-z0-9_-]{8,})/g,
    // 整段就是密钥 → 全部替换
    replace: () => '[redacted]',
  },
  {
    // Authorization: Bearer xxx（保留 Bearer 字样，只替换凭据）
    pattern: /\b(Bearer)\s+[A-Za-z0-9._~+/-]{8,}=*/gi,
    replace: (match) => `${/^\S+/.exec(match)?.[0] ?? 'Bearer'} [redacted]`,
  },
  {
    // apiKey=value / "apiKey": "value" / password: value
    // 值部分分"带引号"与"不带引号"两支，避免 JSON 里的 `", "` 干扰边界。
    pattern:
      /((?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|secret|token)["']?\s*[:=]\s*)(?:"[^"]{6,}"|'[^']{6,}'|[^\s"',;}\]]{6,})/gi,
    // p1 已包含 `apiKey=` 或 `"apiKey": "` 这样的前缀，直接拼接即可保持原格式
    replace: (_match, prefix) => (prefix ? `${prefix}[redacted]` : '[redacted]'),
  },
];

/** 对单个字符串脱敏 */
export function redact(input: string): string {
  let output = input;
  for (const { pattern, replace } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    output = output.replace(pattern, (...args: string[]) => replace(...args));
  }
  return output;
}

/** 递归脱敏任意值（对象/数组/Error），并限制深度避免巨大对象拖垮日志 */
export function redactValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 6) return '[depth limit]';
  if (typeof value === 'string') return redact(value);
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Error) {
    return { name: value.name, message: redact(value.message) };
  }
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactValue(item, depth + 1, seen));

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
    // 字段名本身敏感时，无论值是什么形态都整体替换，避免漏网
    out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redactValue(item, depth + 1, seen);
  }
  return out;
}

// ---- 落盘 ----

function rotateIfNeeded(incoming: number): void {
  if (!logFile) return;
  if (writtenBytes + incoming <= maxBytes) return;
  try {
    const rotated = `${logFile}.1`;
    if (fs.existsSync(logFile)) {
      fs.rmSync(rotated, { force: true });
      fs.renameSync(logFile, rotated);
    }
    writtenBytes = 0;
  } catch {
    // 轮转失败不应影响服务
    writtenBytes = 0;
  }
}

function writeToFile(entry: LogEntry): void {
  if (!logFile) return;
  try {
    const line = `${JSON.stringify(entry)}\n`;
    const bytes = Buffer.byteLength(line, 'utf-8');
    rotateIfNeeded(bytes);
    fs.mkdirSync(path.dirname(path.resolve(logFile)), { recursive: true });
    fs.appendFileSync(logFile, line, 'utf-8');
    writtenBytes += bytes;
  } catch {
    // 磁盘不可写时静默降级为仅控制台输出
  }
}

// ---- 输出 ----

function formatText(entry: LogEntry): string {
  const head = `${entry.time} ${entry.level.toUpperCase().padEnd(5)} [${entry.scope}]`;
  const req = entry.requestId ? ` (req=${entry.requestId})` : '';
  let line = `${head}${req} ${entry.message}`;
  if (entry.detail !== undefined) {
    try {
      line += ` ${typeof entry.detail === 'string' ? entry.detail : JSON.stringify(entry.detail)}`;
    } catch {
      line += ' [unserializable detail]';
    }
  }
  return line;
}

function emit(level: LogLevel, scope: string, message: string, fields: LogFields = {}): void {
  if (LEVEL_WEIGHT[level] < threshold) return;

  const entry: LogEntry = {
    time: new Date().toISOString(),
    level,
    scope,
    message: redact(message),
    ...(fields.requestId ? { requestId: fields.requestId } : {}),
    ...(fields.detail !== undefined ? { detail: redactValue(fields.detail) } : {}),
  };

  ring.push(entry);
  if (ring.length > RING_SIZE) ring.shift();
  writeToFile(entry);

  const line = format === 'json' ? JSON.stringify(entry) : formatText(entry);
  // warn/error 走 stderr，便于 CI 与容器按级别分流
  if (level === 'warn' || level === 'error') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** 派生带固定上下文的子 logger（例如固定的 requestId 或业务作用域） */
  child(scope: string, fields?: LogFields): Logger;
}

export function createLogger(scope: string, base: LogFields = {}): Logger {
  const merge = (fields?: LogFields): LogFields => ({
    requestId: fields?.requestId ?? base.requestId,
    detail: fields?.detail ?? base.detail,
  });
  return {
    debug: (message, fields) => emit('debug', scope, message, merge(fields)),
    info: (message, fields) => emit('info', scope, message, merge(fields)),
    warn: (message, fields) => emit('warn', scope, message, merge(fields)),
    error: (message, fields) => emit('error', scope, message, merge(fields)),
    child: (childScope, fields) => createLogger(childScope, { ...merge(fields), ...fields }),
  };
}

/** 读取最近日志（新→旧），供 /api/logs 使用 */
export function recentLogs(limit = 50, level?: LogLevel): LogEntry[] {
  const min = level ? LEVEL_WEIGHT[level] : 0;
  return ring
    .filter((entry) => LEVEL_WEIGHT[entry.level] >= min)
    .slice(-Math.max(1, Math.min(limit, RING_SIZE)))
    .reverse();
}

export interface LoggerStatus {
  level: LogLevel;
  format: 'text' | 'json';
  file: string | null;
  maxBytes: number;
  buffered: number;
}

export function loggerStatus(): LoggerStatus {
  return {
    level: (Object.keys(LEVEL_WEIGHT) as LogLevel[]).find((l) => LEVEL_WEIGHT[l] === threshold) ?? 'info',
    format,
    file: logFile || null,
    maxBytes,
    buffered: ring.length,
  };
}

/** 供测试使用：改写运行期阈值 */
export function setLogLevel(level: LogLevel): void {
  threshold = LEVEL_WEIGHT[level];
}

/** 供测试使用：清空环形缓冲 */
export function clearRecentLogs(): void {
  ring.length = 0;
}
