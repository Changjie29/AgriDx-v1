/**
 * DeepSeek provider（国内直连可用，无需代理）
 */
import { createOpenAICompatibleProvider } from './openai-compatible.js';
import type { Provider } from './types.js';

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-v4-flash';

export function createDeepSeekProvider(): Provider {
  return createOpenAICompatibleProvider({
    name: 'deepseek',
    model: DEEPSEEK_MODEL,
    apiUrl: DEEPSEEK_API_URL,
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    timeoutMs: 20_000,
    selfIntro: `【模型信息】你当前由 DeepSeek 提供支持，运行模型名称：${DEEPSEEK_MODEL}。当用户询问"你是什么模型/用的是什么模型/背后是哪个大模型"时，请直接如实告知模型名称，不要含糊其辞。`,
  });
}
