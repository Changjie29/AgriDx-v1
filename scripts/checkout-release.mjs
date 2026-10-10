import { assertCleanRepository, git, isMainModule, projectRoot } from './lib/git.mjs';

export function checkoutRelease(tag, root = projectRoot) {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag ?? '')) {
    throw new Error('必须显式指定规范版本标签，例如：npm run checkout:release -- v1.6.1');
  }
  assertCleanRepository(root);
  git(root, ['-c', 'http.version=HTTP/1.1', 'fetch', '--no-tags', 'origin', 'tag', tag]);
  const commit = git(root, ['rev-parse', '--verify', 'refs/tags/' + tag + '^{commit}']);
  const targetPackage = JSON.parse(git(root, ['show', commit + ':package.json']));
  if (targetPackage.version !== tag.slice(1)) {
    throw new Error('标签 ' + tag + ' 与目标 package.json 版本不一致，未切换工作区。');
  }
  git(root, ['switch', '--no-overwrite-ignore', '--detach', commit]);
  return { tag, commit, hasVerify: Boolean(targetPackage.scripts?.verify) };
}

if (isMainModule(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--help') {
      console.log('用法：npm run checkout:release -- v1.6.1\n仅获取标签并检出对应源码；要求工作区干净。');
    } else if (args.length !== 1) {
      throw new Error('必须提供一个版本标签。使用 npm run checkout:release -- --help 查看说明。');
    } else {
      const result = checkoutRelease(args[0]);
      console.log('[release] 已检出 ' + result.tag + '（detached HEAD）：' + result.commit);
      console.log('源码检出完成；部署仍需按目标版本文档安装依赖、验证并启动服务。');
      console.log(result.hasVerify
        ? '验证入口：npm ci，然后 npm run verify。'
        : '该历史版本无 verify 入口，请按它的 README 执行检查。');
      console.log('继续开发时执行 git switch main，或从当前版本新建工作分支。');
    }
  } catch (error) {
    console.error('[release] ' + error.message);
    process.exitCode = 1;
  }
}
