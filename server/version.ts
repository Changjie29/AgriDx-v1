/**
 * 版本信息的唯一来源（Single Source of Truth）
 *
 * 设计原则：
 * - `package.json` 的 `version` 字段是唯一权威版本号；release-please 只改这一个字段
 *   （加上 `package-lock.json` 与 `.release-please-manifest.json`），其余展示位置全部在
 *   运行时派生，因此不存在"日志里是 v1.6.1、页面上还是 v1.6.0"的漂移。
 * - 运行时从磁盘读取，而不是打包时内联。构建产物不复制 `package.json`，
 *   所以这里按目录向上查找，兼容源码运行（`server/`）与编译运行（`dist-server/server/`）。
 * - 提交号与构建时间来自 CI 注入的环境变量；本地开发缺失时如实标记为 unknown，
 *   不编造提交号。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface AppVersion {
  /** package.json 中的应用名 */
  name: string;
  /** 语义化版本号，例如 1.6.1 */
  version: string;
  /** 面向展示的版本字符串，例如 v1.6.1 */
  display: string;
  /** 完整 commit SHA（CI 注入），本地未知时为 null */
  commit: string | null;
  /** 短 commit SHA（7 位），未知时为 null */
  commitShort: string | null;
  /** 构建时间（ISO 8601，CI 注入），本地未知时为 null */
  buildTime: string | null;
  /** 运行环境标识：production / development / test 等 */
  environment: string;
  /** 版本信息来自哪个文件（便于排查构建产物与源码不一致） */
  source: string;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 依次向上查找 package.json，兼容源码运行与 dist-server 运行 */
function findPackageJson(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

interface PackageManifest {
  name?: unknown;
  version?: unknown;
}

let cached: AppVersion | null = null;

/** 规范化版本字符串：去掉前缀 v，保证 v1 / 1.6.1 / v1.6.1 都能得到 1.6.1 */
export function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^v/i, '');
}

export function getAppVersion(): AppVersion {
  if (cached) return cached;

  const pkgPath = findPackageJson(HERE);
  let name = 'agri-fault-diagnosis';
  let version = '0.0.0';
  let source = pkgPath ?? 'package.json (not found)';

  if (pkgPath) {
    try {
      const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as PackageManifest;
      if (typeof parsed.name === 'string' && parsed.name.trim()) name = parsed.name.trim();
      if (typeof parsed.version === 'string' && parsed.version.trim()) version = normalizeVersion(parsed.version);
    } catch {
      // 读取失败时不中断服务，明确回落到 0.0.0 而不是静默给出错误版本
      version = '0.0.0';
      source = `${pkgPath} (unreadable)`;
    }
  }

  // CI 允许用环境变量覆盖（例如镜像构建场景），否则仍以 package.json 为准
  const envVersion = process.env.APP_VERSION?.trim();
  if (envVersion) {
    version = normalizeVersion(envVersion);
    source = `APP_VERSION env (package.json: ${pkgPath ?? 'not found'})`;
  }

  const commit = process.env.GIT_COMMIT?.trim() || process.env.GITHUB_SHA?.trim() || null;
  const buildTime = process.env.BUILD_TIME?.trim() || null;

  cached = {
    name,
    version,
    display: `v${version}`,
    commit,
    commitShort: commit ? commit.slice(0, 7) : null,
    buildTime,
    environment: process.env.NODE_ENV || 'development',
    source,
  };
  return cached;
}

/** 供测试使用：清空缓存后重新读取 */
export function resetAppVersionCache(): void {
  cached = null;
}

/** 启动横幅用的紧凑单行版本描述 */
export function versionLine(): string {
  const v = getAppVersion();
  const parts = [`${v.name} ${v.display}`];
  if (v.commitShort) parts.push(`commit ${v.commitShort}`);
  parts.push(v.environment);
  return parts.join(' | ');
}
