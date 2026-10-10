import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { constants } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const children = [];
let stopping = false;

function resolveCli(packageName) {
  const manifestPath = require.resolve(`${packageName}/package.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[packageName];
  if (typeof bin !== 'string') throw new Error(`${packageName} 未提供 CLI 入口，请先运行 npm ci`);
  return path.resolve(path.dirname(manifestPath), bin);
}

function start(name, cliPath, args) {
  const child = spawn(process.execPath, [cliPath, ...args], {
    cwd: rootDir,
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: 'true' },
    windowsHide: true,
    // POSIX 使用独立进程组，退出时只清理本次启动的服务及其子进程。
    detached: process.platform !== 'win32',
  });
  const closed = new Promise(resolve => child.once('close', resolve));
  children.push({ child, closed });
  child.once('error', error => {
    console.error(`[dev] ${name} 启动失败：${error.message}`);
    shutdown(1);
  });
  child.once('exit', (code, signal) => {
    if (stopping) return;
    const exitCode = code ?? (signal && constants.signals[signal] ? 128 + constants.signals[signal] : 1);
    console.error(`[dev] ${name} 已退出（${signal ?? exitCode}），停止其他开发服务`);
    shutdown(exitCode);
  });
}

function signalGroup(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

async function stop({ child, closed }) {
  if (!child.pid) return closed;
  if (process.platform === 'win32') {
    if (child.exitCode === null && child.signalCode === null) {
      // taskkill 仅以本次启动的 PID 为根，/T 同时结束 tsx 的监视子进程。
      await new Promise((resolve, reject) => {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
        killer.once('error', reject);
        killer.once('exit', code => {
          if (code === 0 || child.exitCode !== null || child.signalCode !== null) resolve();
          else reject(new Error(`taskkill 退出状态 ${code}（PID ${child.pid}）`));
        });
      }).catch(error => {
        console.error(`[dev] 无法结束子进程树：${error.message}`);
        child.kill('SIGKILL');
      });
    }
  } else {
    signalGroup(child, 'SIGTERM');
    let timeout;
    await Promise.race([closed, new Promise(resolve => { timeout = setTimeout(resolve, 3000); })]);
    clearTimeout(timeout);
    // 服务可能先退出；仍结束同一进程组内未退出的监视子进程。
    signalGroup(child, 'SIGKILL');
  }
  await closed;
}

function shutdown(exitCode) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  Promise.all(children.map(stop)).catch(error => {
    console.error(`[dev] 清理失败：${error.message}`);
    if (!process.exitCode) process.exitCode = 1;
  });
}

process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));

try {
  // 先解析两个项目依赖，避免缺少依赖时只启动其中一个服务。
  const clientCli = resolveCli('vite');
  const serverCli = resolveCli('tsx');
  start('vite', clientCli, []);
  start('tsx', serverCli, ['watch', 'server/dev.ts']);
} catch (error) {
  console.error(`[dev] 启动失败：${error.message}`);
  shutdown(1);
}
