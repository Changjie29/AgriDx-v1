# 更新日志

本文件记录 AgriDx-v1 维护线每个版本的主要变化。正式发布状态及对应源码以 [GitHub Releases](https://github.com/Changjie29/AgriDx-v1/releases) 和版本标签为准。

旧标签及版本命名见 [历史版本对照](docs/version-history.md)。本文件不将旧标签名称重新解释成三段版本。

新版本条目由 release-please 根据 Conventional Commits 在发布 PR 中生成；维护者检查条目与实际改动后决定何时发布，正式状态以 tag 和 GitHub Release 为准。请保留已发布段落，后续修复进入新版本；`1.6.0` 是人工登记的基线。章节和版本推进规则见 [历史版本对照](docs/version-history.md#版本号是怎么自动更新的)，操作见 [发布流程](docs/releasing.md)。

不要手工新增正式版本段落。release-please 根据 manifest 记录的上一版本生成新日志，手工插入可能造成重复版本。

## [1.6.2](https://github.com/Changjie29/AgriDx-v1/compare/v1.6.1...v1.6.2) (2026-10-10)


### 问题修复

* 修复裸密钥未脱敏与 Windows 构建收尾失败，完善版本号自动化与日志 ([#6](https://github.com/Changjie29/AgriDx-v1/issues/6)) ([a53e4c9](https://github.com/Changjie29/AgriDx-v1/commit/a53e4c9ade243e4c3975eeeb127e57ab64883b35))


### 代码重构

* **maintenance:** 整理目录、发布校验和跨平台维护流程 ([#8](https://github.com/Changjie29/AgriDx-v1/issues/8)) ([270d05d](https://github.com/Changjie29/AgriDx-v1/commit/270d05dd4664eb454ca96ae9bada04a866dcaadf))

## [1.6.1](https://github.com/Changjie29/AgriDx-v1/compare/v1.6.0...v1.6.1) (2026-10-09)

### 自动化流程

* **release:** 接入自动版本号和更新日志 ([469374c](https://github.com/Changjie29/AgriDx-v1/commit/469374ca6a7642a341eb2834a96b7ec25d7ae1c3))

## 1.6.0 (2026-10-09)

v1 系列的版本管理基线，人工登记，格式与自动生成段落一致。

### 项目维护

* 将 v1 维护线的规范版本基线设为 `1.6.0`，统一 `package.json` 与 `package-lock.json` 的版本号；新标签采用 `vX.Y.Z`。
* 建立独立更新日志和包含完整 commit SHA 的历史版本对照，保留原有标签、提交及 README 历史更新说明。
* README 改为通过链接指向版本来源与日志，开发同步改为工作分支与 PR 流程。

### 自动化流程

* 接入 GitHub CI 和 PR 模板，见 [PR #2](https://github.com/Changjie29/AgriDx-v1/pull/2)。
* 将新增的现有测试纳入 CI，并补齐 PR 验证清单。

### 问题修复

* 纳入已合并的检索协同修复：资料适用范围、对话上下文、本地资料兜底、资料证据与模型推测区分，以及相关测试，见 [PR #1](https://github.com/Changjie29/AgriDx-v1/pull/1)。

本次为人工登记的基线：`1.6.0` 之前的历史没有自动日志，更早的对话体验优化记录继续保留在 [README](README.md)，不为旧版本补写发布说明。自动更新日志和自动创建 tag / Release 的工作流在下一次变更（1.6.1）接入。
