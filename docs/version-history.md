# 历史版本对照

## 当前维护线

本仓库继续维护 **v1 系列**，以 `1.6.0` 作为此次版本规范化基线；规范标签使用 `v1.6.0`。这里选择的是 v1 维护线的接续版本，不将历史上的 2.0 版本重新定义为 1.6.0。

当前发布版本（由发布流程自动同步，勿手工修改）：

<!-- x-release-please-start-version -->
1.6.2
<!-- x-release-please-end -->

后续产品版本以根目录 `package.json` 为准，由发布流程同步 `package-lock.json`、发布 manifest 和更新日志。正式版本对应的准确 commit SHA 从 Git tag 解析，发布记录见 [GitHub Releases](https://github.com/Changjie29/AgriDx-v1/releases)。

## 版本号是怎么自动更新的

版本号只有一个来源：`package.json` 的 `version`。其余位置全部派生或由发布流程同步，避免"日志里是 v1.6.2、页面还显示 v1.6.1"这类漂移。

| 位置 | 谁维护 | 说明 |
| --- | --- | --- |
| `package.json` | release-please | 唯一权威版本号 |
| `package-lock.json` | release-please | node 策略自动同步 |
| `.release-please-manifest.json` | release-please | 记录已发布版本，勿手工改动 |
| `CHANGELOG.md` | release-please | 由 Conventional Commits 自动生成 |
| `docs/version-history.md` | release-please | 通过 `x-release-please-start-version` 注解同步当前版本 |
| 后端 `GET /api/version` | 运行时读取 | 启动时读 `package.json`，无漂移 |
| 前端页脚版本号 | 运行时请求接口 | 发布后无需重新构建前端 |

发布流程：向 `main` 推送 Conventional Commits → release-please 开出版本 PR → 合并后自动打 tag 并创建 GitHub Release。CI 会运行 `node scripts/check-version.mjs` 校验上述文件是否一致。

### 版本号怎么推进

release-please 的默认版本策略（[DefaultVersioningStrategy](https://github.com/googleapis/release-please/blob/main/src/versioning-strategies/default.ts)）只区分三种情况，其余一律兜底为修订号：

| 提交内容 | 下一个版本（当前 `1.6.2`） |
| --- | --- |
| 任意类型带 `!` 或 `BREAKING CHANGE` 说明 | `1.6.2` |
| `feat:` / `feature:` | `1.6.2` |
| `fix:` `perf:` `refactor:` `docs:` `build:` `ci:` `test:` `chore:` `style:` `revert:` | `1.6.2`（默认兜底，不是"只有 fix 才升"） |

所以**维护类提交也会开出版本 PR**：`v1.6.2` 就是由一次 `ci(release): 接入自动版本号和更新日志` 提交产生的。版本号是否前进的决策点在"是否合并 release-please 的版本 PR"，而不是提交类型——不想让一批纯维护改动占用版本号，就不要合并那次的版本 PR，等用户可见的改动攒齐再一起发。

需要指定版本（例如把一批改动定为 `1.6.2`）时，在提交正文里单独写一行 `Release-As: 1.7.0`，release-please 会按它开 PR。release-please 没有"某个类型不触发发布"的配置项，类型差别只体现在日志章节上。

### 更新日志的真值

- 每个版本以 `CHANGELOG.md` 的段落为准；GitHub Release 正文必须与同一段落一致（人工补发旧版本时直接复制该段落）。
- `1.6.2` 起自动生成；`1.6.0` 为人工登记的基线，格式已与自动生成段落对齐。
- `v1.6.2` 的 Release 正文是发布当时手写的说明，与 `CHANGELOG.md` 的 1.6.0 段落措辞不同，作为历史记录保留、不回改；`1.6.1` 起两者一致。
- 发布前确认当前版本段落非空；若一次发布只落出空段落，说明这批改动不应单独发版。

## 规范化版本记录（1.6.2 起）

基线与其后的自动版本登记如下。SHA 为标签解引用后的提交 SHA，可用 `git rev-parse 'vX.Y.Z^{commit}'` 复核。

| 版本 | commit SHA | 发布时间 | 日志段落 | 生成方式 |
| --- | --- | --- | --- | --- |
| v1.6.2 | `7ea9b9577a5ab4a94bc0e5c900ed4f2a4291209d` | 2026-10-09 | [CHANGELOG 1.6.0](../CHANGELOG.md) | 人工登记的基线 Release |
| v1.6.2 | `0941c660837496edcf1c12793b42d79f98cc55d3` | 2026-10-09 | [CHANGELOG 1.6.1](../CHANGELOG.md) | release-please 自动生成（首次） |

新版本由发布流程自动追加到 `CHANGELOG.md`；本表 release-please 不会改动，需要核对时由维护者补充。

## 旧标签与实际源码

核对日期：2026-10-09。以下 SHA 均为标签解引用后的 **提交 SHA**，不是 annotated tag 对象 SHA。提交日期不等同于实际发布日。

| 原标签 | 指向的 commit SHA | 提交日期 | 当时根 package.json 的版本 |
|---|---|---|---|
| v1.00 | `ac8ce7e4203083d5f29e813fd6098c3e3960d5f5` | 2026-09-20 | 该提交无根 package.json |
| v1.01 | `d8d1420471cb8601845bc28b67c6554372aed828` | 2026-09-20 | `1.6.2` |
| v1.02 | `7cfc1743a7ef7edf97298df5fa838ebd5cdd7f55` | 2026-09-22 | `1.6.2` |
| v1.03 | `3680839311b232aca38f358828a058ee6c089c96` | 2026-09-23 | `1.6.2` |
| v1.04 | `0382de788fdce3a11eb9b9ba18f2ef07f0cbf738` | 2026-09-23 | `1.6.2` |
| v1.05 | `cb6b8be05e5f64f5db8142f423cff09df3ca143a` | 2026-09-24 | `1.6.2` |
| v1.06 | `ecfe85810971924bc75a9cb5b514650d5f5e6094` | 2026-09-25 | `1.6.2` |
| v1.5 | `6689e03b53787a3ae5ece2e1bc97919fffda0351` | 2026-09-26 | `1.6.2` |
| v1.0 | `bfe9b73dc154a2d9b949a43a87e0f0e209b6a608` | 2026-09-27 | `1.6.2` |

以上原标签保留原名称和原提交。表中的 package 版本只记录源码中的值，不证明实际发布的先后或标签名称的语义。尤其不将 `v1.06` 自动解释为 `v1.6.2`。

## 曾出现的 2.0 与版本调整

- 历史提交 `35d1106`（“版本升级至 v2.00”）将根 package 版本从 `1.6.2` 改为 `2.0.0`。
- 历史提交 `6689e03` 将 package 版本调整为 `1.6.2`，对应旧标签 `v1.5`。
- 历史提交 `bfe9b73` 将本仓库版本恢复为 `1.6.2`，对应旧标签 `v1.0`。
- 维护者确认项目存在 2.0 版本，并明确本仓库继续使用 v1 系列。此次规范化尊重该维护线选择，保留全部既有记录。
- 本次本地标签核对未发现 2.x 标签；这不否定项目存在 2.0 版本，也不为它虚构本仓库的标签或 Release。

## 基线与后续日志的范围

`1.6.2` 是 v1 系列的治理基线：规范三段版本号，保留旧版本对照，记录已合入主线的 CI 和检索协同修复。具体内容见 [CHANGELOG](../CHANGELOG.md)。

基线发布完成后，自动发布工作流使用 `v1.6.2` 对应的完整 commit SHA 作为首次日志起点。旧历史在本文与 Git / PR 中保留；自动日志登记基线之后的变化。

验证基线的源码提交时，在仓库根目录执行：

```powershell
git rev-parse 'v1.6.2^{commit}'
```

该命令应在标签已创建并拉取到本地后执行。
