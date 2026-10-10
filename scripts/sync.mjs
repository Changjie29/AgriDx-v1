import { assertCleanRepository, git, isMainModule, projectRoot } from './lib/git.mjs';

export function syncBranch(root = projectRoot) {
  assertCleanRepository(root);
  const branch = git(root, ['branch', '--show-current']);
  if (!branch) throw new Error('当前处于 detached HEAD。请先创建或切换到工作分支。');
  const protectedBranches = new Set(['main', 'master']);
  try {
    const defaultRef = git(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
    protectedBranches.add(defaultRef.replace(/^origin\//, ''));
  } catch {
    // origin/HEAD 可能尚未建立；main/master 仍不可直接推送。
  }
  if (protectedBranches.has(branch)) {
    throw new Error('请先从主分支创建工作分支，再通过 PR 合并。此命令不直接推送主分支。');
  }
  git(root, ['-c', 'http.version=HTTP/1.1', 'push', '--no-follow-tags', '--set-upstream', 'origin', 'HEAD:refs/heads/' + branch]);
  return branch;
}

if (isMainModule(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--help') {
      console.log('用法：npm run sync\n先自行提交选定的改动，本命令只推送当前工作分支并设置 upstream。');
    } else if (args.length) {
      throw new Error('此命令不接受参数。使用 npm run sync -- --help 查看说明。');
    } else {
      const branch = syncBranch();
      console.log('[sync] 已推送 ' + branch + '。接下来在 GitHub 创建 PR，等待 CI 通过后合并。');
    }
  } catch (error) {
    console.error('[sync] ' + error.message);
    process.exitCode = 1;
  }
}
