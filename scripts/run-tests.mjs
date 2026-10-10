/**
 * 编译型测试运行器：用 tsc 把 server + tests 编译成 ESM，再交给 node --test 执行。
 *
 * 与 `npm test`（tsx 直跑 .ts）的区别：
 * - 不依赖 tsx/esbuild，因此不依赖"子进程管道"能力，在受限沙箱、只读 CI，
 *   或 esbuild 二进制无法执行的平台（部分 Windows/企业环境）上依然可用。
 * - 顺带验证"编译产物真的能跑"——这正是 dist-server 部署路径的核心风险点。
 *
 * 用法：
 *   node scripts/run-tests.mjs             # 全部测试
 *   node scripts/run-tests.mjs version     # 只跑文件名含 version 的测试
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { rootDir, cli } from './lib/build-utils.mjs';

const outDir = path.join(rootDir, 'node_modules', '.testbuild');

function run(label, command, args) {
  const result = spawnSync(command, args, { cwd: rootDir, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    console.error(`[test:domain] ${label} 失败${result.error ? `: ${result.error.message}` : ''}`);
    process.exit(result.status ?? 1);
  }
}

// 清理固定测试产物目录，避免删除或重命名测试后仍执行旧文件。
// 递归删除前核对真实路径，拒绝符号链接或 junction 指向工作区外。
if (fs.existsSync(outDir)) {
  const resolvedRoot = fs.realpathSync(rootDir);
  const resolvedOutput = fs.realpathSync(outDir);
  if (resolvedOutput !== path.join(resolvedRoot, 'node_modules', '.testbuild')) {
    throw new Error(`测试输出目录不在预期位置：${resolvedOutput}`);
  }
  fs.rmSync(resolvedOutput, { recursive: true, force: true });
}

// 1) 编译（同时充当类型检查）
const [tscCommand, tscPrefix] = cli.tsc();
run('编译', tscCommand, [...tscPrefix, '-p', 'tsconfig.testbuild.json']);

// 2) 收集测试文件
const filter = process.argv[2];
const testsDir = path.join(outDir, 'tests');
if (!fs.existsSync(testsDir)) {
  console.error(`[test:domain] 未找到编译后的测试目录：${testsDir}`);
  process.exit(1);
}
const testFiles = fs
  .readdirSync(testsDir)
  .filter((name) => name.endsWith('.test.js'))
  .filter((name) => !filter || name.includes(filter))
  .sort()
  .map((name) => path.join(testsDir, name));

if (testFiles.length === 0) {
  console.error(`[test:domain] 没有匹配的测试文件${filter ? `（过滤词：${filter}）` : ''}`);
  process.exit(1);
}
console.log(`[test:domain] 运行 ${testFiles.length} 个测试文件`);

// 3) 单进程内运行（--test-isolation=none），避免依赖子进程管道
const result = spawnSync(
  process.execPath,
  ['--test-reporter=spec', '--test', '--test-isolation=none', '--test-force-exit', ...testFiles],
  { cwd: rootDir, stdio: 'inherit' },
);
process.exit(result.status ?? 1);
