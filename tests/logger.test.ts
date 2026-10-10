import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLogger, redact, redactValue, recentLogs, clearRecentLogs, setLogLevel } from '../server/logger.js';

test('常见密钥形态一律脱敏', () => {
  // 前缀型：裸密钥（没有 key= 包裹）也必须整体替换
  for (const secret of [
    'sk-abcdefghijklmnop',
    'gsk_abcdefghijklmnopqrst',
    'AIzaSyA1234567890abcdefg',
    'xai-abcdefghijklmnop',
  ]) {
    const out = redact(`调用失败 ${secret} 结束`);
    assert.ok(!out.includes(secret), `裸密钥未替换：${secret} -> ${out}`);
    assert.equal(out, '调用失败 [redacted] 结束');
  }
  // 带 key= 包裹
  assert.equal(redact('key=sk-abcdefghijklmnop'), 'key=[redacted]');
  // Bearer
  assert.equal(redact('Authorization: Bearer abcdefghijklmn'), 'Authorization: Bearer [redacted]');
  // key=value
  assert.equal(redact('DEEPSEEK_API_KEY=verysecretvalue123'), 'DEEPSEEK_API_KEY=[redacted]');
  assert.equal(redact('password: hunter2hunter2'), 'password: [redacted]');
  // JSON（多种空格/引号写法都要覆盖）
  for (const sample of [
    '{"apiKey":"verysecretvalue123"}',
    '{"apiKey": "verysecretvalue123"}',
    "{'apiKey': 'verysecretvalue123'}",
    '{ "client_secret" : "verysecretvalue123" }',
  ]) {
    assert.ok(!redact(sample).includes('verysecretvalue123'), `未脱敏：${sample}`);
    assert.match(redact(sample), /\[redacted\]/);
  }
});

test('一行里出现多个密钥时全部替换', () => {
  const out = redact('a=sk-abcdefghijklmnop b=sk-zyxwvutsrqponmlk');
  assert.ok(!out.includes('sk-abcdefghijklmnop'));
  assert.ok(!out.includes('sk-zyxwvutsrqponmlk'));
  assert.equal((out.match(/\[redacted\]/g) ?? []).length, 2);
});

test('对象里以敏感字段名存储的密钥也会被脱敏', () => {
  // 该场景不经过正则（没有 key= 或 : 文本），必须靠字段名识别
  const out = redactValue({ token: 'rawsecretvalue', apiKey: 'anothersecret' }) as Record<string, unknown>;
  assert.equal(out.token, '[redacted]');
  assert.equal(out.apiKey, '[redacted]');
});

test('普通业务文本不被误伤', () => {
  const text = '拖拉机水温过高，检查散热器和节温器';
  assert.equal(redact(text), text);
  assert.equal(redact('chunks=26 files=2'), 'chunks=26 files=2');
  // 非敏感字段名不应被替换
  assert.equal(redact('{"model":"deepseek-v4-flash"}'), '{"model":"deepseek-v4-flash"}');
});

test('对象与数组递归脱敏，Error 转为可序列化结构', () => {
  // 故意用非敏感字段名（blob/value），确保是递归逻辑而非"字段名命中"把它挡住的
  const value = redactValue({
    blob: 'sk-abcdefghijklmnop',
    list: ['gsk_abcdefghijklmnopqrst'],
    deep: { nested: { value: 'AIzaSyA1234567890abcdefg' } },
    error: new Error('failed with xai-abcdefghijklmnop'),
  }) as Record<string, any>;
  const flat = JSON.stringify(value);
  for (const secret of ['sk-abcdefghijklmnop', 'gsk_abcdefghijklmnopqrst', 'AIzaSyA1234567890abcdefg', 'xai-abcdefghijklmnop']) {
    assert.ok(!flat.includes(secret), `嵌套值未脱敏：${secret}`);
  }
  assert.equal(value.error.name, 'Error');
  assert.match(value.error.message, /\[redacted\]/);
});

test('循环引用不会导致栈溢出', () => {
  const cyclic: Record<string, unknown> = { name: 'root' };
  cyclic.self = cyclic;
  const out = redactValue(cyclic) as Record<string, unknown>;
  assert.equal(out.self, '[circular]');
});

test('环形缓冲保留最近日志并可按级别过滤', () => {
  clearRecentLogs();
  setLogLevel('debug');
  const log = createLogger('test-scope');
  log.debug('调试信息');
  log.info('普通信息');
  log.warn('警告信息');
  log.error('错误信息', { requestId: 'req-123', detail: { status: 500 } });

  const all = recentLogs(50);
  assert.equal(all.length, 4);
  // 最新的在最前
  assert.equal(all[0].level, 'error');
  assert.equal(all[0].requestId, 'req-123');

  const warns = recentLogs(50, 'warn');
  assert.equal(warns.length, 2);
  assert.deepEqual(warns.map((e) => e.level).sort(), ['error', 'warn']);

  const limited = recentLogs(2);
  assert.equal(limited.length, 2);
  assert.equal(limited[0].level, 'error');
});

test('日志内容在入缓冲前已脱敏', () => {
  clearRecentLogs();
  setLogLevel('debug');
  createLogger('redaction').info('使用密钥 sk-abcdefghijklmnop 调用接口');
  const entry = recentLogs(1)[0];
  assert.ok(!entry.message.includes('sk-abcdefghijklmnop'));
  assert.match(entry.message, /\[redacted\]/);
});

test('子 logger 继承 requestId 上下文', () => {
  clearRecentLogs();
  setLogLevel('debug');
  const child = createLogger('parent').child('child', { requestId: 'req-abc' });
  child.info('带上下文的日志');
  const entry = recentLogs(1)[0];
  assert.equal(entry.scope, 'child');
  assert.equal(entry.requestId, 'req-abc');
});

test('设置 LOG_FILE 后写入 JSONL 并按大小轮转', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agridx-log-'));
  const file = path.join(dir, 'app.jsonl');
  const previousFile = process.env.LOG_FILE;
  const previousBytes = process.env.LOG_MAX_BYTES;
  const previousLevel = process.env.LOG_LEVEL;
  try {
    process.env.LOG_FILE = file;
    process.env.LOG_MAX_BYTES = '400';
    process.env.LOG_LEVEL = 'info';
    // 通过查询串绕过模块缓存，让新的环境变量生效
    const fresh = await import(`../server/logger.js?file=${Date.now()}`);
    const log = fresh.createLogger('file-test');
    for (let i = 0; i < 20; i++) log.info(`写盘测试 ${i}`, { detail: { index: i } });

    assert.ok(fs.existsSync(file), '应写入主日志文件');
    const mainLines = fs.readFileSync(file, 'utf-8').trim().split('\n');
    assert.ok(mainLines.length > 0);
    // 每行都是合法 JSON，且带时间戳/级别/作用域
    const parsed = JSON.parse(mainLines[0]);
    assert.equal(parsed.scope, 'file-test');
    assert.ok(parsed.time);

    // 超过阈值后应产生 .1 轮转文件
    assert.ok(fs.existsSync(`${file}.1`), '应产生轮转文件');
  } finally {
    if (previousFile === undefined) delete process.env.LOG_FILE; else process.env.LOG_FILE = previousFile;
    if (previousBytes === undefined) delete process.env.LOG_MAX_BYTES; else process.env.LOG_MAX_BYTES = previousBytes;
    if (previousLevel === undefined) delete process.env.LOG_LEVEL; else process.env.LOG_LEVEL = previousLevel;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
