/**
 * 版本信息（前端）
 *
 * 版本号的唯一来源在后端：`package.json` 由发布流程（release-please）自动递增，
 * 后端在运行时读取后经 `GET /api/version` 暴露。前端运行时拉取，因此
 * **不需要为了改版本号重新构建前端**，也不会出现"页面显示旧版本"的漂移。
 *
 * 构建期由 vite.config.ts 注入 `__APP_VERSION__` 作为兜底：接口不可用时仍能显示
 * 本次构建对应的版本，并明确标注为"构建版本"而不是伪装成运行时版本。
 */
import { useEffect, useState } from 'react';

/** 构建期注入的版本号（见 vite.config.ts 的 define） */
declare const __APP_VERSION__: string;

export interface VersionInfo {
  name: string;
  version: string;
  display: string;
  commit: string | null;
  commitShort: string | null;
  buildTime: string | null;
  environment: string;
  startedAt?: string;
  uptimeSeconds?: number;
  knowledge?: { chunkCount?: number; fileCount?: number };
}

export type VersionSource = 'live' | 'build';

export interface VersionState {
  /** 当前展示的版本；接口与构建期都拿不到时为 null */
  version: VersionInfo | null;
  /** live = 来自后端接口；build = 构建期注入的兜底值 */
  source: VersionSource | null;
  loading: boolean;
}

/** 构建期兜底值；未注入时返回 null 而不是空字符串 */
export function buildVersion(): VersionInfo | null {
  try {
    if (typeof __APP_VERSION__ === 'string' && __APP_VERSION__) {
      return {
        name: 'agri-fault-diagnosis',
        version: __APP_VERSION__,
        display: `v${__APP_VERSION__}`,
        commit: null,
        commitShort: null,
        buildTime: null,
        environment: 'build',
      };
    }
  } catch {
    // 未经过 Vite 构建（例如单测环境）时 __APP_VERSION__ 不存在
  }
  return null;
}

/**
 * 读取运行中的后端版本。失败时静默回落到构建期版本，
 * 不弹错误提示——版本显示不应该干扰主要功能。
 */
export function useVersion(): VersionState {
  const [state, setState] = useState<VersionState>(() => {
    const build = buildVersion();
    return { version: build, source: build ? 'build' : null, loading: true };
  });

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch('/api/version', { signal: controller.signal });
        if (!response.ok) throw new Error(`status ${response.status}`);
        const data = (await response.json()) as VersionInfo;
        if (typeof data?.version !== 'string' || !data.version) throw new Error('malformed');
        setState({ version: data, source: 'live', loading: false });
      } catch {
        if (controller.signal.aborted) return;
        setState((prev) => ({ ...prev, loading: false }));
      }
    })();
    return () => controller.abort();
  }, []);

  return state;
}
