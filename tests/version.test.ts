import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getAppVersion, normalizeVersion, resetAppVersionCache, versionLine } from '../server/version.js';

test('运行时版本来自 package.json，且与文件内容一致', () => {
  resetAppVersionCache();
  const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8')) as { name: string; version: string };
  const v = getAppVersion();
  assert.equal(v.version, normalizeVersion(pkg.version));
  assert.equal(v.name, pkg.name);
  assert.equal(v.display, `v${normalizeVersion(pkg.version)}`);
  assert.ok(path.isAbsolute(v.source) || v.source.includes('package.json'));
});

test('版本号格式为三段 semver，且不残留 v 前缀', () => {
  resetAppVersionCache();
  const v = getAppVersion();
  assert.match(v.version, /^\d+\.\d+\.\d+/);
  assert.ok(!v.version.startsWith('v'), `version 不应带 v 前缀：${v.version}`);
});

test('normalizeVersion 统一各种写法', () => {
  assert.equal(normalizeVersion('  v1.6.1 '), '1.6.1');
  assert.equal(normalizeVersion('V2.0.0'), '2.0.0');
  assert.equal(normalizeVersion('1.6.1'), '1.6.1');
});

test('APP_VERSION 可覆盖版本号（镜像构建场景）', () => {
  const original = process.env.APP_VERSION;
  try {
    process.env.APP_VERSION = '9.9.9';
    resetAppVersionCache();
    const v = getAppVersion();
    assert.equal(v.version, '9.9.9');
    assert.match(v.source, /APP_VERSION/);
  } finally {
    if (original === undefined) delete process.env.APP_VERSION;
    else process.env.APP_VERSION = original;
    resetAppVersionCache();
  }
});

test('未注入 commit 时如实标记为 null，不伪造提交号', () => {
  const originalCommit = process.env.GIT_COMMIT;
  const originalSha = process.env.GITHUB_SHA;
  try {
    delete process.env.GIT_COMMIT;
    delete process.env.GITHUB_SHA;
    resetAppVersionCache();
    const v = getAppVersion();
    assert.equal(v.commit, null);
    assert.equal(v.commitShort, null);
    assert.ok(!versionLine().includes('commit'));
  } finally {
    if (originalCommit !== undefined) process.env.GIT_COMMIT = originalCommit;
    if (originalSha !== undefined) process.env.GITHUB_SHA = originalSha;
    resetAppVersionCache();
  }
});

test('注入 commit 时提供 7 位短 SHA', () => {
  const originalCommit = process.env.GIT_COMMIT;
  try {
    process.env.GIT_COMMIT = 'abcdef1234567890abcdef1234567890abcdef12';
    resetAppVersionCache();
    const v = getAppVersion();
    assert.equal(v.commitShort, 'abcdef1');
    assert.match(versionLine(), /commit abcdef1/);
  } finally {
    if (originalCommit === undefined) delete process.env.GIT_COMMIT;
    else process.env.GIT_COMMIT = originalCommit;
    resetAppVersionCache();
  }
});

test('版本信息被缓存，多次读取返回同一对象', () => {
  resetAppVersionCache();
  assert.equal(getAppVersion(), getAppVersion());
});
