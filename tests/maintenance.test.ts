import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git } from '../scripts/lib/git.mjs';
import { syncBranch } from '../scripts/sync.mjs';
import { checkoutRelease } from '../scripts/checkout-release.mjs';

function fixture(t: TestContext) {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const sandbox = fs.mkdtempSync(path.join(tempRoot, 'agridx-maintenance-'));
  t.after(() => {
    const absolute = fs.realpathSync(sandbox);
    assert.equal(path.dirname(absolute), tempRoot);
    assert.ok(path.basename(absolute).startsWith('agridx-maintenance-'));
    fs.rmSync(absolute, { recursive: true, force: true });
  });
  const root = path.join(sandbox, 'working');
  const remote = path.join(sandbox, 'remote.git');
  fs.mkdirSync(root);
  const hooks = path.join(sandbox, 'empty-hooks');
  fs.mkdirSync(hooks);
  git(root, ['init', '--initial-branch=main']);
  git(root, ['config', 'user.name', 'AgriDx test']);
  git(root, ['config', 'user.email', 'test@example.invalid']);
  git(root, ['config', 'commit.gpgSign', 'false']);
  git(root, ['config', 'tag.gpgSign', 'false']);
  git(root, ['config', 'core.hooksPath', hooks]);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.6.1' }));
  git(root, ['add', 'package.json']);
  git(root, ['commit', '-m', 'chore: initial']);
  git(root, ['init', '--bare', '--initial-branch=main', remote]);
  git(root, ['remote', 'add', 'origin', remote]);
  git(root, ['push', '-u', 'origin', 'main']);
  return { root, remote };
}

test('同步脚本拒绝直接推送主分支和 detached HEAD', t => {
  const { root, remote } = fixture(t);
  const before = git(remote, ['rev-parse', 'main']);
  assert.throws(() => syncBranch(root), /工作分支/);
  git(root, ['switch', '--detach']);
  assert.throws(() => syncBranch(root), /detached HEAD/);
  assert.equal(git(remote, ['rev-parse', 'main']), before);
});

test('同步脚本保留未提交文件，不自动暂存或创建提交', t => {
  const { root } = fixture(t);
  git(root, ['switch', '-c', 'codex/local-work']);
  const before = git(root, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(root, 'unfinished.txt'), 'local work');
  assert.throws(() => syncBranch(root), /未提交改动/);
  assert.equal(git(root, ['rev-parse', 'HEAD']), before);
  assert.equal(git(root, ['diff', '--cached', '--name-only']), '');
  assert.equal(fs.readFileSync(path.join(root, 'unfinished.txt'), 'utf8'), 'local work');
});

test('同步脚本只推送已提交工作分支，远端 main 保持原提交', t => {
  const { root, remote } = fixture(t);
  const main = git(remote, ['rev-parse', 'main']);
  git(root, ['switch', '-c', 'codex/next-update']);
  fs.writeFileSync(path.join(root, 'feature.txt'), 'change');
  git(root, ['add', 'feature.txt']);
  git(root, ['commit', '-m', 'fix: update']);
  assert.equal(syncBranch(root), 'codex/next-update');
  assert.equal(git(remote, ['rev-parse', 'refs/heads/codex/next-update']), git(root, ['rev-parse', 'HEAD']));
  assert.equal(git(remote, ['rev-parse', 'main']), main);
  assert.equal(git(root, ['rev-parse', '--abbrev-ref', '@{upstream}']), 'origin/codex/next-update');
});

test('版本检出要求显式规范标签，并保护未提交内容', t => {
  const { root } = fixture(t);
  const before = git(root, ['rev-parse', 'HEAD']);
  for (const tag of [undefined, 'main', '--force', 'v1.06', 'v1.6.1-beta.1']) {
    assert.throws(() => checkoutRelease(tag, root), /规范版本标签/);
  }
  fs.writeFileSync(path.join(root, 'unfinished.txt'), 'keep');
  assert.throws(() => checkoutRelease('v1.6.1', root), /未提交改动/);
  assert.equal(git(root, ['rev-parse', 'HEAD']), before);
  assert.equal(git(root, ['branch', '--show-current']), 'main');
});

test('同步脚本不会因 followTags 配置额外发布本地标签', t => {
  const { root, remote } = fixture(t);
  git(root, ['switch', '-c', 'codex/tag-isolation']);
  git(root, ['config', 'push.followTags', 'true']);
  git(root, ['tag', '-a', 'v9.9.9', '-m', 'local only']);
  assert.equal(syncBranch(root), 'codex/tag-isolation');
  assert.equal(git(remote, ['tag', '--list']), '');
  assert.equal(git(root, ['tag', '--list']), 'v9.9.9');
  assert.equal(git(remote, ['rev-parse', 'refs/heads/codex/tag-isolation']), git(root, ['rev-parse', 'HEAD']));
});

test('历史标签跟踪忽略文件时拒绝覆盖本地配置', t => {
  const { root } = fixture(t);
  const server = path.join(root, 'server');
  fs.mkdirSync(server);
  const envFile = path.join(server, '.env');
  fs.writeFileSync(envFile, 'historical-default');
  git(root, ['add', 'server/.env']);
  git(root, ['commit', '-m', 'chore: historical fixture']);
  git(root, ['tag', 'v1.6.1']);
  git(root, ['push', 'origin', 'refs/tags/v1.6.1']);
  git(root, ['rm', 'server/.env']);
  fs.writeFileSync(path.join(root, '.gitignore'), 'server/.env\n');
  git(root, ['add', '.gitignore']);
  git(root, ['commit', '-m', 'chore: keep config local']);
  fs.mkdirSync(server, { recursive: true });
  fs.writeFileSync(envFile, 'current-local-config');
  const before = git(root, ['rev-parse', 'HEAD']);
  assert.equal(git(root, ['status', '--porcelain']), '');
  assert.throws(() => checkoutRelease('v1.6.1', root), /overwritten|untracked/i);
  assert.equal(fs.readFileSync(envFile, 'utf8'), 'current-local-config');
  assert.equal(git(root, ['rev-parse', 'HEAD']), before);
  assert.equal(git(root, ['branch', '--show-current']), 'main');
});

test('版本检出使用标签对应提交，不移动 main，不安装依赖或启动服务', t => {
  const { root, remote } = fixture(t);
  const released = git(root, ['rev-parse', 'HEAD']);
  git(root, ['tag', '-a', 'v1.6.1', '-m', 'release']);
  git(root, ['push', 'origin', 'refs/tags/v1.6.1']);
  git(root, ['tag', '-d', 'v1.6.1']);
  fs.writeFileSync(path.join(root, 'later.txt'), 'after release');
  git(root, ['add', 'later.txt']);
  git(root, ['commit', '-m', 'chore: later work']);
  const main = git(root, ['rev-parse', 'main']);
  const result = checkoutRelease('v1.6.1', root);
  assert.equal(result.commit, released);
  assert.equal(result.hasVerify, false);
  assert.equal(git(root, ['rev-parse', 'HEAD']), released);
  assert.equal(git(root, ['branch', '--show-current']), '');
  assert.equal(git(root, ['rev-parse', 'main']), main);
  assert.equal(git(remote, ['rev-parse', 'main']), released);
  assert.equal(fs.existsSync(path.join(root, 'node_modules')), false);
  assert.equal(git(root, ['status', '--porcelain']), '');
});

test('标签与源码版本不一致时保留当前分支和源码', t => {
  const { root } = fixture(t);
  git(root, ['tag', 'v1.6.2']);
  git(root, ['push', 'origin', 'refs/tags/v1.6.2']);
  const before = git(root, ['rev-parse', 'HEAD']);
  assert.throws(() => checkoutRelease('v1.6.2', root), /版本不一致/);
  assert.equal(git(root, ['rev-parse', 'HEAD']), before);
  assert.equal(git(root, ['branch', '--show-current']), 'main');
});
