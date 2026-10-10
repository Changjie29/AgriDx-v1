/**
 * LLM Router
 *
 * 选择策略（按当前网络环境）：
 *   - 检测到代理（HTTPS_PROXY / https_proxy / HTTP_PROXY / http_proxy）→ Gemini 优先
 *   - 否则                                          → DeepSeek 优先
 *   - 主选失败（网络/超时/服务端错误/鉴权 401/403）  → 自动回退另一个
 *   - 两个都失败                                    → 抛 ProviderError 给上层
 *
 * 鉴权失败也会尝试另一个 provider，方便排查 key 配置问题。
 * 日志只打印 provider 名与错误类别，绝不打印 API Key。
 */
import { detectProxy } from './http.js';
import { createGeminiProvider } from './gemini.js';
import { createDeepSeekProvider } from './deepseek.js';
import { createLogger } from '../logger.js';
import {
  ProviderError,
  type ChatMessage,
  type ChatResult,
  type Provider,
} from './types.js';

export interface RouteOutcome {
  result: ChatResult;
  /** 实际主选是谁 */
  primary: 'gemini' | 'deepseek';
  /** 是否发生了 fallback */
  fellBack: boolean;
}

// 统一经 server/logger.ts 输出：自动脱敏，绝不打印 key
const log = createLogger('llm');

export class LlmRouter {
  private readonly gemini: Provider;
  private readonly deepseek: Provider;

  constructor() {
    this.gemini = createGeminiProvider();
    this.deepseek = createDeepSeekProvider();
  }

  /** 启动时打印一次配置状态（不泄露 key） */
  printConfig() {
    const proxy = detectProxy();
    log.info(
      'provider 配置已加载',
      {
        detail: {
          gemini: this.gemini.isConfigured() ? 'configured' : 'missing',
          deepseek: this.deepseek.isConfigured() ? 'configured' : 'missing',
          proxy: proxy.present ? 'detected' : 'none',
        },
      },
    );
  }

  /**
   * 决定本次请求的主选 provider。
   * 规则：有代理 → Gemini 优先；无代理 → DeepSeek 优先。
   * 主选未配置时自动用另一个。
   */
  private pickPrimary(): { primary: Provider; secondary: Provider } {
    const proxy = detectProxy();
    let first: Provider;
    let second: Provider;
    if (proxy.present) {
      first = this.gemini;
      second = this.deepseek;
    } else {
      first = this.deepseek;
      second = this.gemini;
    }
    // 主选未配置则交换
    if (!first.isConfigured() && second.isConfigured()) {
      log.warn('主选 provider 未配置，自动切换', { detail: { from: first.name, to: second.name } });
      [first, second] = [second, first];
    }
    return { primary: first, secondary: second };
  }

  async chat(messages: ChatMessage[]): Promise<RouteOutcome> {
    const { primary, secondary } = this.pickPrimary();

    if (!primary.isConfigured() && !secondary.isConfigured()) {
      throw new ProviderError(primary.name, 'unknown', 'no LLM API key configured');
    }

    // 1) 主选
    try {
      const result = await primary.chat(messages);
      return { result, primary: primary.name, fellBack: false };
    } catch (err) {
      if (err instanceof ProviderError) {
        // 任何错误（含鉴权失败）都尝试另一个 provider，方便排查 key 问题
        log.warn('主选 provider 调用失败，尝试回退', {
          detail: { provider: primary.name, kind: err.kind, fallback: secondary.name },
        });
      } else {
        log.warn('主选 provider 异常，尝试回退', {
          detail: { provider: primary.name, error: err instanceof Error ? err.name : 'unknown' },
        });
      }
    }

    // 2) 回退
    if (secondary.isConfigured()) {
      try {
        const result = await secondary.chat(messages);
        return { result, primary: primary.name, fellBack: true };
      } catch (err) {
        if (err instanceof ProviderError) {
          log.error('回退 provider 也失败', { detail: { provider: secondary.name, kind: err.kind } });
        } else {
          log.error('回退 provider 异常', {
            detail: { provider: secondary.name, error: err instanceof Error ? err.name : 'unknown' },
          });
        }
        throw err;
      }
    }

    throw new ProviderError(primary.name, 'unknown', 'both providers failed');
  }
}

/** 单例：进程内复用 */
let singleton: LlmRouter | null = null;
export function getLlmRouter(): LlmRouter {
  if (!singleton) {
    singleton = new LlmRouter();
    singleton.printConfig();
  }
  return singleton;
}
