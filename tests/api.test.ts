import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Agent, fetch } from 'undici';
import app, { VERSION } from '../server/index.js';
import { clearRecentLogs, setLogLevel } from '../server/logger.js';

/**
 * 接口层验证：版本暴露、请求 ID 透传、日志与脱敏。
 *
 * server/index.ts 只构建 app、不监听端口，因此这里显式 listen(0)，
 * 不会与开发服务器抢 8787。
 */
async function withServer(run: (base: string, agent: Agent) => Promise<void>): Promise<void> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const agent = new Agent();
  try {
    await run(`http://127.0.0.1:${address.port}`, agent);
  } finally {
    await agent.close();
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
}

test('/api/health 返回 ok、版本号与知识库统计', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/health`);
    assert.equal(response.status, 200);
    const data = (await response.json()) as {
      ok: boolean;
      version: string;
      knowledge: { chunkCount: number; fileCount: number; scannedFiles: number };
    };
    assert.equal(data.ok, true);
    assert.equal(data.version, VERSION.version);
    assert.ok(data.knowledge.chunkCount > 0, '知识库应有可用片段');
    assert.ok(data.knowledge.scannedFiles >= data.knowledge.fileCount);
  });
});

test('/api/version 暴露版本、来源与知识库自检信息', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/version`);
    assert.equal(response.status, 200);
    const data = (await response.json()) as {
      version: string;
      display: string;
      source: string;
      environment: string;
      startedAt: string;
      uptimeSeconds: number;
      knowledge: { chunkCount: number };
    };
    assert.match(data.version, /^\d+\.\d+\.\d+/);
    assert.equal(data.display, `v${data.version}`);
    assert.ok(data.source.includes('package.json'), `source 应指向 package.json，实际 ${data.source}`);
    assert.ok(Number.isInteger(data.uptimeSeconds));
    assert.ok(!Number.isNaN(Date.parse(data.startedAt)));
    assert.ok(data.knowledge.chunkCount > 0);
  });
});

test('每个请求都带 X-Request-Id，且可被上游指定', async () => {
  await withServer(async (base) => {
    const generated = await fetch(`${base}/api/health`);
    const requestId = generated.headers.get('x-request-id');
    assert.ok(requestId, '应返回 X-Request-Id');
    assert.match(requestId!, /^[A-Za-z0-9_-]{8,64}$/);

    const forwarded = await fetch(`${base}/api/health`, { headers: { 'x-request-id': 'trace-abc-123456' } });
    assert.equal(forwarded.headers.get('x-request-id'), 'trace-abc-123456');
  });
});

test('非法 X-Request-Id 被忽略并替换为服务端生成值', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/health`, { headers: { 'x-request-id': 'bad id! with spaces' } });
    const requestId = response.headers.get('x-request-id');
    assert.ok(requestId);
    assert.notEqual(requestId, 'bad id! with spaces');
  });
});

test('访问日志记录到环形缓冲，且包含请求 ID 与状态码', async () => {
  clearRecentLogs();
  setLogLevel('info');
  await withServer(async (base) => {
    await fetch(`${base}/api/health`);
    await fetch(`${base}/api/version`);
  });
  // res 'finish' 回调在响应结束后触发，等一拍再断言
  await new Promise((resolve) => setTimeout(resolve, 50));
  const { recentLogs } = await import('../server/logger.js');
  const entries = recentLogs(20).filter((e) => e.message === '请求完成');
  const paths = entries.map((e) => (e.detail as { path?: string })?.path);
  assert.ok(paths.includes('/api/health'), `应记录 /api/health，实际 ${paths.join(',')}`);
  assert.ok(paths.includes('/api/version'), `应记录 /api/version，实际 ${paths.join(',')}`);
  assert.ok(entries.every((e) => typeof e.requestId === 'string' && e.requestId.length > 0));
});

test('日志接口默认关闭，开启后可按级别过滤', async () => {
  await withServer(async (base) => {
    const disabled = await fetch(`${base}/api/logs`);
    assert.equal(disabled.status, 404);
    const body = (await disabled.json()) as { code: string };
    assert.equal(body.code, 'logs_disabled');
  });

  const original = process.env.ENABLE_LOG_ENDPOINT;
  process.env.ENABLE_LOG_ENDPOINT = 'true';
  try {
    clearRecentLogs();
    setLogLevel('info');
    await withServer(async (base) => {
      await fetch(`${base}/api/health`);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const response = await fetch(`${base}/api/logs?limit=10&level=info`);
      assert.equal(response.status, 200);
      const data = (await response.json()) as {
        status: { level: string; buffered: number };
        entries: { level: string; message: string }[];
      };
      assert.ok(data.status.buffered >= 1);
      assert.ok(data.entries.length >= 1);
      assert.ok(data.entries.every((e) => e.level === 'info' || e.level === 'warn' || e.level === 'error'));
    });
  } finally {
    if (original === undefined) delete process.env.ENABLE_LOG_ENDPOINT;
    else process.env.ENABLE_LOG_ENDPOINT = original;
  }
});

test('日志接口的 limit 被限制在 1..200', async () => {
  const original = process.env.ENABLE_LOG_ENDPOINT;
  process.env.ENABLE_LOG_ENDPOINT = 'true';
  try {
    await withServer(async (base) => {
      const huge = await fetch(`${base}/api/logs?limit=99999`);
      assert.equal(huge.status, 200);
      const data = (await huge.json()) as { entries: unknown[] };
      assert.ok(data.entries.length <= 200);
    });
  } finally {
    if (original === undefined) delete process.env.ENABLE_LOG_ENDPOINT;
    else process.env.ENABLE_LOG_ENDPOINT = original;
  }
});

test('/api/knowledge 列出实际参与检索的资料文件', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/knowledge`);
    assert.equal(response.status, 200);
    const data = (await response.json()) as {
      indexedSources: string[];
      warnings: string[];
      fileCount: number;
    };
    assert.equal(data.indexedSources.length, data.fileCount);
    assert.ok(data.indexedSources.some((s) => s.includes('拖拉机')), `实际来源：${data.indexedSources.join(',')}`);
    assert.ok(data.indexedSources.some((s) => s.includes('约翰迪尔9R')), `实际来源：${data.indexedSources.join(',')}`);
    // enabled=false 的示例资料会产生"已跳过"提示，这是预期行为；
    // 不应出现"缺元信息"或"无 ## 章节"这类真正的格式告警。
    assert.ok(
      data.warnings.every((w) => w.includes('enabled=false')),
      `出现了非预期的知识库告警：${data.warnings.join(' | ')}`,
    );
  });
});

test('未知路径返回 404 而不是 500', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/does-not-exist`);
    assert.equal(response.status, 404);
  });
});

test('CORS 白名单拒绝非允许来源', async () => {
  await withServer(async (base, agent) => {
    const response = await fetch(`${base}/api/health`, {
      dispatcher: agent,
      headers: { Origin: 'https://evil.example.com' },
    });
    // cors 中间件拒绝时由全局错误兜底返回 5xx
    assert.ok(response.status >= 400, `非白名单来源不应成功，实际 ${response.status}`);
  });
});
