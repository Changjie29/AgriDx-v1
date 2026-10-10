/**
 * OpenAI 兼容 chat/completions 通用请求实现。
 * Gemini (v1beta/openai) 与 DeepSeek 都遵循此格式，差别只在 URL/Model/Key。
 */
import { fetchWithTimeout } from './http.js';
import {
  ProviderError,
  type ChatMessage,
  type ChatResult,
  type Provider,
  type ProviderName,
} from './types.js';

interface OpenAICompatibleOptions {
  name: ProviderName;
  model: string;
  apiUrl: string;
  apiKeyEnv: string;
  /** 超时毫秒 */
  timeoutMs?: number;
  /** system prompt 末尾追加的"模型自述"提示 */
  selfIntro?: string;
}

export function createOpenAICompatibleProvider(opts: OpenAICompatibleOptions): Provider {
  const { name, model, apiUrl, apiKeyEnv, timeoutMs = 25_000, selfIntro } = opts;

  function getKey(): string | undefined {
    return process.env[apiKeyEnv];
  }

  return {
    name,
    model,
    isConfigured() {
      const k = getKey();
      return Boolean(k && k.trim().length > 0);
    },
    async chat(messages: ChatMessage[]): Promise<ChatResult> {
      const apiKey = getKey();
      if (!apiKey) {
        throw new ProviderError(name, 'unknown', `missing ${apiKeyEnv}`);
      }

      // 追加模型自述（让模型被问到时如实回答自己是谁）
      const outgoing: ChatMessage[] = selfIntro
        ? (() => {
            const withIntro = [...messages];
            if (withIntro[0]?.role === 'system') {
              withIntro[0] = { ...withIntro[0], content: withIntro[0].content + '\n\n' + selfIntro };
            } else {
              withIntro.unshift({ role: 'system', content: selfIntro });
            }
            return withIntro;
          })()
        : messages;

      let response: Response;
      try {
        response = await fetchWithTimeout(
          apiUrl,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model,
              messages: outgoing,
              temperature: 0.3,
              stream: false,
            }),
          },
          timeoutMs,
        );
      } catch (err) {
        // 网络层错误（含超时）
        const kind = err instanceof Error && err.message === 'timeout' ? 'timeout' : 'network';
        throw new ProviderError(name, kind, err instanceof Error ? err.message : String(err));
      }

      if (!response.ok) {
        const errText = (await response.text().catch(() => '')).slice(0, 300);
        if (response.status === 401 || response.status === 403) {
          throw new ProviderError(name, 'auth', errText);
        }
        if (response.status === 400 || response.status === 422) {
          throw new ProviderError(name, 'bad_request', errText);
        }
        if (response.status >= 500) {
          throw new ProviderError(name, 'server_error', errText);
        }
        throw new ProviderError(name, 'unknown', `HTTP ${response.status}: ${errText}`);
      }

      const data = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
        model?: string;
        usage?: ChatResult['usage'];
      };
      const content = data?.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new ProviderError(name, 'unknown', 'empty response');
      }
      return {
        content,
        provider: name,
        model: data.model || model,
        usage: data.usage,
      };
    },
  };
}
