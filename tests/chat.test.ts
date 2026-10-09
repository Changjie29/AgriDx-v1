import { Agent, fetch } from 'undici';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLlmRouter } from '../server/llm/router';
process.env.NODE_ENV = 'test';
const { default: app } = await import('../server/index');
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
    assert.equal((await send({ messages: [{ role: 'user', content: '问题' }], model: {} })).status, 400);
    assert.equal((await send({ messages: [{ role: 'assistant', content: '只有助手' }] })).status, 400);
  } finally {
    router.chat = original;
    await localAgent.close();
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  }
});
