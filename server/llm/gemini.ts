/**
 * Gemini provider（通过 OpenAI 兼容接口访问）
 * - 需要网络可达 Google（有代理时通常可用）
 */
import { createOpenAICompatibleProvider } from './openai-compatible.js';
import type { Provider } from './types.js';

const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const GEMINI_MODEL = 'gemini-3.6-flash';

export function createGeminiProvider(): Provider {
  return createOpenAICompatibleProvider({
    name: 'gemini',
    model: GEMINI_MODEL,
    apiUrl: GEMINI_API_URL,
    apiKeyEnv: 'GEMINI_API_KEY',
    timeoutMs: 20_000,
    selfIntro: `【模型信息】你当前由 Gemini 提供支持，运行模型名称：${GEMINI_MODEL}。当用户询问"你是什么模型/用的是什么模型/背后是哪个大模型"时，请直接如实告知模型名称，不要含糊其辞。`,
  });
}
