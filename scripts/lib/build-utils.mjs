/**
 * 构建脚本的共享工具。
 *
 * 关键点：一律优先用 `node <包>/bin/<入口>.js` 调用 CLI，而不是直接执行
 * node_modules/.bin 下的 .cmd/.ps1 包装脚本——包装脚本在部分 Windows /
 * 受限环境下会以 EINVAL / EPERM 失败，且在 CI 上行为不一致。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 本文件位于 scripts/lib/，因此仓库根目录要向上两级
export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 解析 node_modules/.bin 下的可执行文件（兼容 Windows 的 .cmd 包装） */
export function binPath(name, root = rootDir) {
  const candidates = process.platform === 'win32' ? [`${name}.cmd`, `${name}.exe`, name] : [name];
  for (const candidate of candidates) {
    const full = path.join(root, 'node_modules', '.bin', candidate);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

/**
 * 解析某个包提供的 CLI，返回 [command, prefixArgs]。
 * 优先走包内 JS 入口（用当前 node 执行），失败再回落到 .bin 包装脚本。
 */
export function resolveCli({ pkg, bin, fallback }, root = rootDir) {
  const entry = path.join(root, 'node_modules', ...pkg.split('/'), bin);
  if (fs.existsSync(entry)) return [process.execPath, [entry]];
  const fallbackPath = binPath(fallback, root);
  if (fallbackPath) return [fallbackPath, []];
  throw new Error(`找不到 ${fallback}，请先运行 npm ci`);
}

/** 已解析好的常用 CLI 快捷方式 */
export const cli = {
  tsc: () => resolveCli({ pkg: 'typescript', bin: 'bin/tsc', fallback: 'tsc' }),
  vite: () => resolveCli({ pkg: 'vite', bin: 'bin/vite.js', fallback: 'vite' }),
  eslint: () => resolveCli({ pkg: 'eslint', bin: 'bin/eslint.js', fallback: 'eslint' }),
};
