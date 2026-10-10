/**
 * 一键验证：CI 与本地共用同一套检查，避免"本地过了 CI 挂"。
 *
 * 步骤：
 *   1. 版本一致性（scripts/check-version.mjs，含一致性静态检查）
 *   2. 前端类型检查（tsc -b tsconfig.app.json）
 *   3. 后端类型检查（tsc -p tsconfig.server.json）
 *   4. 编译并运行测试（scripts/run-tests.mjs）
 *   5. 构建前端 dist/ 与后端 dist-server/（供 npm start 使用）
 *   6. 复检版本一致性，这次包含"运行时读取到的版本"（需要上一步产物）
 *   7. ESLint（存在 eslint 时执行）
 *
 * 用法：
 *   node scripts/verify.mjs              # 全部
 *   node scripts/verify.mjs --no-lint    # 跳过 lint
 *   node scripts/verify.mjs --no-test    # 跳过测试，只做类型检查与编译
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { rootDir, cli } from './lib/build-utils.mjs';

const args = new Set(process.argv.slice(2));
const runLint = !args.has('--no-lint');
const runTest = !args.has('--no-test');

const results = [];

function summarize() {
  console.log('\n=== 验证结果 ===');
  for (const { label, ok, durationMs } of results) {
    const mark = ok ? '\u2714' : '\u2716';
    console.log(`  ${mark} ${label}  (${(durationMs / 1000).toFixed(1)}s)`);
  }
}

function step(label, [command, prefix], commandArgs) {
  process.stdout.write(`\n\u25b6 ${label}\n`);
  const startedAt = Date.now();
  const result = spawnSync(command, [...prefix, ...commandArgs], { cwd: rootDir, stdio: 'inherit' });
  const durationMs = Date.now() - startedAt;
  const ok = !result.error && result.status === 0;
  results.push({ label, ok, durationMs });
  if (!ok) {
    console.error(`\n\u2716 ${label} 失败${result.error ? `: ${result.error.message}` : `（退出码 ${result.status}）`}`);
    summarize();
    process.exit(result.status ?? 1);
  }
}

// 1) 版本一致性（静态部分，不依赖构建产物）
step('版本一致性（静态）', [process.execPath, []], [path.join(rootDir, 'scripts', 'check-version.mjs')]);

// 2~3) 类型检查
step('前端类型检查', cli.tsc(), ['-b', 'tsconfig.app.json', '--noEmit']);
step('后端类型检查', cli.tsc(), ['-p', 'tsconfig.server.json', '--noEmit']);

// 4) 编译并运行测试
if (runTest) {
  step('编译并运行测试', [process.execPath, []], [path.join(rootDir, 'scripts', 'run-tests.mjs')]);
}

// 5) 使用统一构建入口，CI 也验证 Vite 打包及 Windows 临时目录处理。
step('构建前后端产物', [process.execPath, []], [path.join(rootDir, 'scripts', 'build.mjs')]);

// 6) 复检：这次会真的 import 产物里的 version.js，验证运行时版本与 package.json 一致
step('版本一致性（含运行时）', [process.execPath, []], [path.join(rootDir, 'scripts', 'check-version.mjs')]);

// 7) Lint
if (runLint) {
  try {
    step('ESLint', cli.eslint(), ['.', '--cache', '--cache-location', 'node_modules/.eslintcache', '--report-unused-disable-directives']);
  } catch {
    console.log('\n\u25b6 跳过 ESLint（未安装）');
  }
}

summarize();
console.log('\n全部检查通过');
