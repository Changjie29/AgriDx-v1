import { Agent, fetch } from 'undici';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLlmRouter } from '../server/llm/router.js';
// server/index.ts 只构建 app、不监听端口，因此可以安全地直接 import
import app from '../server/index.js';
test('chat接口模型失败返回本地资料，非法输入拒绝', async () => {
  const router = getLlmRouter();
  const original = router.chat;
  router.chat = async () => { throw new Error('simulated offline'); };
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const localAgent = new Agent();
  const send = (body: unknown) => fetch(`http://127.0.0.1:${address.port}/api/chat`, { dispatcher: localAgent, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const response = await send({ messages: [{ role: 'user', content: '散热器冷却液泄漏' }] });
    assert.equal(response.status, 200);
    const data = await response.json() as { answerMode: string; provider: null; sources: unknown[]; choices: { message: { content: string } }[] };
    assert.equal(data.answerMode, 'local');
    assert.equal(data.provider, null);
    assert.ok(data.sources.length);
    assert.match(data.choices[0].message.content, /尚未形成诊断结论/);
    router.chat = async () => ({ primary: 'deepseek', fellBack: false, result: { provider: 'deepseek', model: 'mock', content: JSON.stringify({ summary: '症状待确认', evidence: [], hypotheses: ['通用可能原因，待核实'], questions: ['发生工况是什么？'], checks: [] }) } });
    const generated = await (await send({ messages: [{ role: 'user', content: 'xyzqwerty' }] })).json() as { answerMode: string; evidenceMode: string; choices: { message: { content: string } }[] };
    assert.equal(generated.answerMode, 'model');
    assert.equal(generated.evidenceMode, 'general_only');
    assert.match(generated.choices[0].message.content, /模型补充分析/);
    router.chat = async () => ({ primary: 'deepseek', fellBack: false, result: { provider: 'deepseek', model: 'mock', content: '不合格的未分层输出' } });
    const invalid = await (await send({ messages: [{ role: 'user', content: '散热器' }] })).json() as { answerMode: string };
    assert.equal(invalid.answerMode, 'local');
    assert.equal((await send({ messages: [{ role: 'user', content: '问题' }], model: {} })).status, 400);
    assert.equal((await send({ messages: [{ role: 'assistant', content: '只有助手' }] })).status, 400);
  } finally {
    router.chat = original;
    await localAgent.close();
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  }
});
