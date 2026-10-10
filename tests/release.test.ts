import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateReleaseState } from '../scripts/lib/release-state.mjs';

function fixture(version = '1.6.1') {
  return {
    packageJson: { version },
    lockfile: { version, packages: { '': { version } } },
    manifest: { '.': version },
    releaseConfig: {
      'release-type': 'node',
      'include-component-in-tag': false,
      'include-v-in-tag': true,
      packages: { '.': { 'changelog-path': 'CHANGELOG.md' } },
    },
    changelog: `# 更新日志\n\n## [${version}](https://example.com/compare) (2026-10-09)\n\n- 修复\n\n## 1.6.0 (2026-10-09)\n\n- 基线\n\n## 历史版本 2.0\n`,
  };
}

test('当前稳定版基线和机器人同步更新全部版本记录均通过', () => {
  assert.deepEqual(validateReleaseState(fixture()), []);
  const updated = fixture('1.6.2');
  updated.changelog = `## 1.6.2 (2026-10-10)\n\n- 自动发布\n\n${fixture().changelog}`;
  assert.deepEqual(validateReleaseState(updated), []);
});

test('只运行 npm version 后指出落后的 manifest 和更新日志', () => {
  const state = fixture();
  state.packageJson.version = '1.6.2';
  state.lockfile.version = '1.6.2';
  state.lockfile.packages[''].version = '1.6.2';
  const errors = validateReleaseState(state);
  assert.equal(errors.length, 2);
  assert.ok(errors.some(error => error.includes('.release-please-manifest.json["."]')));
  assert.ok(errors.some(error => error.includes('CHANGELOG.md first release heading')));
});

test('lockfile 根包版本偏离时，即使顶层版本相同也拒绝', () => {
  const state = fixture();
  state.lockfile.packages[''].version = '1.6.0';
  const errors = validateReleaseState(state);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /package-lock\.json\.packages\[""\]\.version/u);
});

test('顶层 lockfile 版本缺失时报告具体位置', () => {
  const state = fixture();
  const lockfile = { packages: state.lockfile.packages };
  assert.match(validateReleaseState({ ...state, lockfile })[0], /package-lock\.json\.version.*missing/u);
});

test('重复正式版本标题被拒绝，v 前缀和链接不掩盖重复', () => {
  const state = fixture();
  state.changelog += '\n## v1.6.1 (2026-10-10)\n\n- 重复\n';
  assert.deepEqual(validateReleaseState(state), ['CHANGELOG.md: duplicate release heading for 1.6.1']);
});

test('忽略未发布章节、代码示例和非规范历史记录', () => {
  const state = fixture();
  state.changelog = `## Unreleased\n\n示例：\n\n\`\`\`md\n## 9.9.9\n\`\`\`\n\n## v2.0 历史名称\n\n${state.changelog}`;
  assert.deepEqual(validateReleaseState(state), []);
});

test('只支持无前导零的稳定三段版本', () => {
  for (const version of ['v1.6.1', '1.6', '01.6.1', '1.06.1', '1.6.01', '1.6.1-beta.1', '1.6.1+build.2']) {
    assert.ok(validateReleaseState(fixture(version)).some(error => error.startsWith('package.json.version:')));
  }
});

test('Node 策略可在包级覆盖，默认日志路径和其他布尔 tag 设置保持有效', () => {
  const state = fixture();
  const releaseConfig = {
    'release-type': 'simple',
    'include-component-in-tag': true,
    'include-v-in-tag': false,
    packages: { '.': { 'release-type': 'node' } },
  };
  assert.deepEqual(validateReleaseState({ ...state, releaseConfig }), []);
  assert.deepEqual(validateReleaseState({ ...state, releaseConfig: { ...releaseConfig, packages: { '.': { 'release-type': 'node', 'changelog-path': './CHANGELOG.md' } } } }), []);
});

test('策略或日志位置漂移和非法 tag 参数分别指出配置位置', () => {
  const state = fixture();
  const releaseConfig = {
    'release-type': 'simple',
    'include-v-in-tag': 'true',
    packages: { '.': { 'changelog-path': 'docs/CHANGELOG.md' } },
  };
  const errors = validateReleaseState({ ...state, releaseConfig });
  assert.equal(errors.length, 3);
  assert.ok(errors.some(error => error.includes('effective release-type')));
  assert.ok(errors.some(error => error.includes('effective changelog-path')));
  assert.ok(errors.some(error => error.includes('include-v-in-tag')));
  assert.match(validateReleaseState({ ...state, releaseConfig: { packages: {} } })[0], /packages\["\."\]/u);
});
