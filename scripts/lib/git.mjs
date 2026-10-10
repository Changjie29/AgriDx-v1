import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

export function git(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout).trim() || 'Git 命令失败。');
  }
  return result.stdout.trim();
}

export function assertCleanRepository(root) {
  const top = git(root, ['rev-parse', '--show-toplevel']);
  if (realpathSync(top) !== realpathSync(root)) {
    throw new Error('请在项目自身的 Git 仓库中执行。');
  }
  if (git(root, ['status', '--porcelain', '--untracked-files=normal'])) {
    throw new Error('工作区有未提交改动。请先检查 git status，提交或保存自己的改动后再运行。');
  }
}

export function isMainModule(url) {
  return Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === url;
}
