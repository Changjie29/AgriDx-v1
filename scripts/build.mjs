/**
 * 跨平台构建脚本（取代原先只能跑在 Unix 上的 build.sh）
 *
 * 产物：
 *   dist/         前端静态站点（Vite 输出，可交给任意静态服务器/CDN）
 *   dist-server/  后端编译产物（tsc 输出，Node 可直接以 ESM 运行）
 *
 * 用法：
 *   node scripts/build.mjs              # 前端 + 后端
 *   node scripts/build.mjs --server     # 只构建后端
 *   node scripts/build.mjs --client     # 只构建前端
 *
 * 说明：
 * - 通过包内 JS 入口调用 tsc/vite，不依赖 shell、不依赖 PATH，
 *   Windows / macOS / Linux / CI 行为一致。
 * - 构建时把版本号与 commit 写入环境变量，供 server/version.ts 与前端读取。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { rootDir, cli } from './lib/build-utils.mjs';

const args = new Set(process.argv.slice(2));
const buildClient = args.has('--client') || !args.has('--server');
const buildServer = args.has('--server') || !args.has('--client');

const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));

// esbuild（Vite 的打包引擎）会在系统临时目录下建 esbuild-<hash> 工作目录，
// 构建结束后再删除。在部分 Windows 环境里这个清理会被安全软件占用而失败，
// 报错形如：
//   [vite:esbuild-transpile] remove C:\Users\...\AppData\Local\Temp\esbuild-xxx: Access is denied
// 注意此时 Vite 其实已经打包成功（"3053 modules transformed"），只是收尾失败，
// 但进程仍以非 0 退出，构建看起来就失败了。
//
// 关键：esbuild 用的是 Node 的 os.tmpdir()（见 esbuild/lib/main.js 里的
// os.tmpdir() + "esbuild-<32字节随机hex>"），**不认 ESBUILD_TMPDIR**。
// Windows 上 os.tmpdir() 取决于 TEMP / TMP 环境变量，所以必须改这两个变量，
// 把临时目录挪到仓库内可写位置，才能绕开受管控的系统临时目录。
const esbuildTmpDir = path.join(rootDir, 'node_modules', '.cache', 'esbuild-tmp');
fs.mkdirSync(esbuildTmpDir, { recursive: true });

const buildEnv = {
  ...process.env,
  APP_VERSION: pkg.version,
  GIT_COMMIT: process.env.GIT_COMMIT || process.env.GITHUB_SHA || '',
  BUILD_TIME: new Date().toISOString(),
  // 允许 CI 或本地用 DSH_BUILD_TMPDIR 指定别处
  TEMP: process.env.DSH_BUILD_TMPDIR || esbuildTmpDir,
  TMP: process.env.DSH_BUILD_TMPDIR || esbuildTmpDir,
};

function run(label, [command, prefix], commandArgs) {
  console.log(`\n[build] ${label}`);
  const result = spawnSync(command, [...prefix, ...commandArgs], {
    cwd: rootDir,
    env: buildEnv,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(`[build] ${label} 启动失败: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[build] ${label} 失败，退出码 ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

console.log(`[build] ${pkg.name} v${pkg.version} (node ${process.version}, ${process.platform})`);
console.log(`[build] 构建临时目录 (TEMP/TMP): ${buildEnv.TEMP}`);

if (buildClient) {
  // 前端：tsc 只做类型检查（noEmit），Vite 负责打包
  run('前端类型检查', cli.tsc(), ['-b', 'tsconfig.app.json']);
  run('前端打包', cli.vite(), ['build']);
}

if (buildServer) {
  run('后端编译', cli.tsc(), ['-p', 'tsconfig.server.json']);
}

const outputs = [];
if (buildClient) outputs.push('dist/        （前端站点）');
if (buildServer) outputs.push('dist-server/ （后端 ESM，node dist-server/server/main.js）');

console.log('\n[build] 构建完成');
for (const line of outputs) console.log(`  - ${line}`);
