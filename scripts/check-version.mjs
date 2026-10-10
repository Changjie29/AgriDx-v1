/**
 * 版本一致性检查（可独立运行，无第三方依赖）
 *
 * 这个脚本是"自动版本号 + 更新日志"能长期可信的关键：它把"版本号应该一致"
 * 从口头约定变成 CI 会拦截的检查项。
 *
 * 检查内容：
 *   1. package.json 的 version 是规范稳定 X.Y.Z
 *   2. package-lock.json 顶层 version 与 package.json 一致
 *      （release-please 的 node 策略会同步它；不一致说明手工改漏了）
 *   3. .release-please-manifest.json 的 "." 与 package.json 一致
 *   4. CHANGELOG.md 的最新正式条目对应当前版本，无重复版本
 *   5. docs/version-history.md 存在且带有 release-please 的版本同步注解
 *   6. 后端运行时读取到的版本与 package.json 一致（防止版本来源被改坏）
 *   7. release-please 根包使用 Node 策略和根 CHANGELOG
 *
 * 用法：node scripts/check-version.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateReleaseState } from './lib/release-state.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const notes = [];

function readJson(relPath) {
  const full = path.join(rootDir, relPath);
  if (!fs.existsSync(full)) {
    errors.push(`缺少文件：${relPath}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(full, 'utf-8'));
  } catch (e) {
    errors.push(`${relPath} 不是合法 JSON：${e.message}`);
    return null;
  }
}

function readText(relPath) {
  const full = path.join(rootDir, relPath);
  if (!fs.existsSync(full)) {
    errors.push(`缺少文件：${relPath}`);
    return null;
  }
  return fs.readFileSync(full, 'utf-8');
}

// 1) package.json
const pkg = readJson('package.json');
if (!pkg) {
  console.error(errors.join('\n'));
  process.exit(1);
}
const version = pkg.version;
const normalize = (v) => String(v ?? '').trim().replace(/^v/i, '');
// 2~4) 共用可测试的校验逻辑：版本必须完全一致，最新日志必须对应当前版本。
const lock = readJson('package-lock.json');
const manifest = readJson('.release-please-manifest.json');
const releaseConfig = readJson('release-please-config.json');
const changelog = readText('CHANGELOG.md');
const stateErrors = validateReleaseState({ packageJson: pkg, lockfile: lock, manifest, releaseConfig, changelog });
errors.push(...stateErrors);
if (!stateErrors.length) {
  notes.push(`package.json version = ${version}`);
  notes.push('package-lock.json、manifest 与最新 CHANGELOG 版本一致，发布配置有效');
}

// 5) 版本对照文档 + release-please 同步注解
// 注意：release-please 的 generic updater 按"整行"识别块标记，
// start/end 必须各自独占一行，否则该块不会生效（发布时会静默漏更新）。
const history = readText('docs/version-history.md');
if (history !== null) {
  const lines = history.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.includes('x-release-please-start-version'));
  const endIndex = lines.findIndex((line) => line.includes('x-release-please-end'));
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    errors.push('docs/version-history.md 缺少成对的 x-release-please-start-version / x-release-please-end 注解，' +
      '发布时不会自动更新当前版本');
  } else {
    const startLineOnly = /^\s*<!--\s*x-release-please-start-version\s*-->\s*$/.test(lines[startIndex]);
    const endLineOnly = /^\s*<!--\s*x-release-please-end\s*-->\s*$/.test(lines[endIndex]);
    if (!startLineOnly || !endLineOnly) {
      errors.push('docs/version-history.md 的版本块注解必须各自独占一行（release-please 按行识别），' +
        '当前写法不会生效');
    } else {
      const inside = lines.slice(startIndex + 1, endIndex).join('\n');
      const blockVersion = normalize(inside.match(/\d+\.\d+\.\d+(?:-[\w.]+)?/)?.[0]);
      if (!blockVersion) {
        errors.push('docs/version-history.md 的版本块内没有可识别的版本号（应单独一行写 1.6.1）');
      } else if (blockVersion !== normalize(version)) {
        errors.push(`docs/version-history.md 版本块内是 ${blockVersion}，与 package.json 的 ${version} 不一致`);
      } else {
        notes.push('docs/version-history.md 版本块与 package.json 一致');
      }
    }
  }
}

// 6) 后端运行时版本
// tsconfig.server.json 的 rootDir 是 server/，因此产物结构为 dist-server/<文件>.js
// （不是 dist-server/server/<文件>.js）。这里两个路径都尝试，避免因目录调整而静默跳过。
const compiledVersionCandidates = [
  path.join(rootDir, 'dist-server', 'version.js'),
  path.join(rootDir, 'dist-server', 'server', 'version.js'),
];
const compiledVersion = compiledVersionCandidates.find((candidate) => fs.existsSync(candidate));
if (compiledVersion) {
  // 直接 import 构建产物里的 version 模块（而不是派生 node 子进程）：
  // 沙箱/受限环境可能禁止带管道的子进程，in-process import 没有这个限制。
  // 想要"真正的独立进程 smoke test"，用 scripts/lib/version-probe.mjs。
  try {
    const { pathToFileURL } = await import('node:url');
    const module = await import(pathToFileURL(compiledVersion).href);
    if (typeof module.getAppVersion !== 'function') {
      errors.push(`构建产物未导出 getAppVersion：${path.relative(rootDir, compiledVersion)}`);
    } else {
      const runtime = module.getAppVersion();
      if (normalize(runtime.version) !== normalize(version)) {
        errors.push(`后端运行时版本 (${runtime.version}) 与 package.json (${version}) 不一致`);
      } else {
        notes.push(`后端运行时版本一致（${runtime.display}，来源：${path.relative(rootDir, compiledVersion)}）`);
      }
    }
  } catch (e) {
    errors.push(`无法加载构建产物 ${path.relative(rootDir, compiledVersion)}：${e.message}`);
  }
} else {
  notes.push('未找到 dist-server 产物，跳过运行时版本检查（先运行 npm run build:server 可纳入检查）');
}

// 汇总
console.log('=== 版本一致性检查 ===');
for (const note of notes) console.log(`  ok   ${note}`);
if (errors.length) {
  console.error('\n=== 发现不一致 ===');
  for (const error of errors) console.error(`  FAIL ${error}`);
  console.error(`\n共 ${errors.length} 项问题。修复方式：以 package.json 为准同步其余文件，` +
    '或交由 release-please 的发布 PR 自动处理。');
  process.exit(1);
}
console.log(`\n全部通过（当前版本 ${version}）`);
