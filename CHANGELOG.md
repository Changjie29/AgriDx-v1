# 更新日志

本文件记录 AgriDx-v1 维护线每个版本的主要变化。正式发布状态及对应源码以 [GitHub Releases](https://github.com/Changjie29/AgriDx-v1/releases) 和版本标签为准。

旧标签及版本命名见 [历史版本对照](docs/version-history.md)。本文件不将旧标签名称重新解释成三段版本。

## [1.6.1](https://github.com/Changjie29/AgriDx-v1/compare/v1.6.0...v1.6.1) (2026-10-09)


### 自动化流程

* **release:** 接入自动版本号和更新日志 ([469374c](https://github.com/Changjie29/AgriDx-v1/commit/469374ca6a7642a341eb2834a96b7ec25d7ae1c3))

## 1.6.0 (2026-10-09)

### 版本管理

- 将 v1 维护线的规范版本基线设为 `1.6.0`，统一 `package.json` 与 `package-lock.json` 的版本号；新标签采用 `vX.Y.Z`。
- 建立独立更新日志和包含完整 commit SHA 的历史版本对照，保留原有标签、提交及 README 历史更新说明。
- 接入的 GitHub CI 和 PR 模板已合并到主分支，见 [PR #2](https://github.com/Changjie29/AgriDx-v1/pull/2)。
- 将新增的现有测试纳入 CI，并补齐 PR 验证清单。
- README 通过链接指向版本来源与日志，开发同步改为工作分支与 PR 流程。

### 基线纳入的已有修复

- 纳入已合并的检索协同修复：资料适用范围、对话上下文、本地资料兜底、资料证据与模型推测区分，以及相关测试，见 [PR #1](https://github.com/Changjie29/AgriDx-v1/pull/1)。这些变化此前已进入主分支，本条将它们登记在新规范基线中。

### 发布安排

- 本次先建立版本基线；自动更新日志和自动创建 tag / Release 的工作流将另行接入。
- 更早的对话体验优化记录继续保留在 [README](README.md)，不虚构旧版本的发布说明。
