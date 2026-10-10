# 发布与维护流程

本仓库维护 v1 系列。规范版本为稳定的 `X.Y.Z`，规范标签为 `vX.Y.Z`；当前流程不接入 alpha、beta 等预发布版本。既有标签、提交和已发布日志保留原记录，旧名称的含义见 [历史版本对照](version-history.md)。

## 版本和日志的来源

release-please 维护以下内容：

| 文件 | 发布时更新的内容 |
|---|---|
| `package.json` | 根 `version` |
| `package-lock.json` | 顶层 `version` 与 `packages[""].version` |
| `.release-please-manifest.json` | 根包 `"."` 的版本 |
| `CHANGELOG.md` | 新版本条目、提交链接和版本比较链接 |
| `docs/version-history.md` | 当前版本块，通过 `extra-files` 的 generic updater 同步 |

工作 PR 保持上述五处版本一致，由发布 PR 统一推进版本。历史文档的 `x-release-please-start-version` 与 `x-release-please-end` 注解须各自独占一行，块内保留当前版本；旧标签对照表由维护者核对补充，发布工具不会自动填写历史 SHA。

`npm run check:version` 调用 `scripts/check-version.mjs`，共用 `scripts/lib/release-state.mjs` 验证稳定 SemVer、package/lockfile/manifest、日志首个正式版本与重复版本、发布配置，并检查历史文档版本块；已有构建产物时还检查后端运行时版本。`npm run verify` 依次检查版本、前后端类型、编译后测试、前后端完整构建、运行时版本复检和 Lint。

本机与 CI 使用 `.node-version` 的 Node 24 和 npm 11，根 package 的 `engines` 声明同一范围。构建、验证和维护命令使用 Node 脚本，Windows PowerShell 使用 `npm.cmd`。

正式发布以 tag 和 GitHub Release 为准。main 中的新改动在合并发布 PR 前仍处于待发布阶段，package 字段不能替代确切的 commit SHA。后续发布保留旧 tag 的原提交，修正已发布问题通过新的工作 PR 和后续版本记录。

后端在服务启动时读取根 `package.json` 并缓存；`APP_VERSION` 可覆盖运行时版本，`GET /api/version` 的 `source` 标明来源。前端页脚优先读取这个接口，接口不可用时显示构建版本。更新后端并重启后，展示新版本无需为了版本号单独重建前端；`GIT_COMMIT`（或 `GITHUB_SHA`）与 `BUILD_TIME` 需在服务进程环境提供，仅构建不会把它们固化到后端产物。

## 工作 PR

1. 从最新 main 创建短期分支，例如 `codex/knowledge-paths`。
2. 完成修改后安装锁定依赖并运行完整检查：

   ```powershell
   npm.cmd ci
   npm.cmd run verify
   ```

3. 审阅 diff，显式提交需要的文件。推送可以使用普通 Git 命令，也可以运行：

   ```powershell
   npm.cmd run sync
   ```

   同步脚本要求当前为非 main 的已提交、干净工作分支，只推送当前分支，不附带本地标签，不自动暂存或创建提交。
4. 创建 PR，填写变更行为、验证和兼容性说明。PR 标题采用约定式提交格式，使用 **Squash and merge**，确认最终合并标题仍表达完整变更。

| 标题类型 | 用途 | 版本影响 |
|---|---|---|
| `fix(scope): ...` | 兼容的错误修复 | patch，例如 1.6.1 → 1.6.2 |
| `feat(scope): ...` | 兼容的新功能 | minor，例如 1.6.1 → 1.7.0 |
| `refactor/docs/build/ci/test/chore/style/perf/revert` | 对应的维护或改进 | 当前可见日志配置会累计这些变化，通常提出 patch 发布 PR |

多个 PR 的改动按最高版本影响累计。普通 v1 更新保持兼容；不兼容改动先由维护者明确维护线和迁移方案，再使用 `!` 或最终 squash 正文中的 `BREAKING CHANGE:`。release-please 默认会把此类变化计算为新的 major；当前版本检查只验证格式与一致性，不拦截跨 major，也不会为留在 v1 而自动降格版本语义。

PR 正文中的兼容性说明须在 squash 时保留需要的迁移信息。主线最终提交决定自动日志，开发分支中的临时提交不应成为不准确的发布说明。

## 机器人发布 PR

工作 PR 合入 main 后，Release Please workflow 会创建或更新累计的发布 PR。发布 PR 修改 package、lockfile、manifest、更新日志与历史文档版本块，维护者审阅后决定何时发布。

1. 当前 workflow 使用内置 `GITHUB_TOKEN`。机器人创建或更新 PR 的 `opened`、`synchronize`、`reopened` 事件生成待批准的 CI 运行；具有仓库写权限的维护者点击 **Approve workflows to run**，批准最新运行。
2. 确认 `ci-verify` 通过，检查五处版本一致、日志覆盖实际变化、迁移说明准确。
3. 合并发布 PR，后续 Release Please 运行创建同版本 tag 和 GitHub Release。
4. 核对 Release 已发布，tag 与发布 PR 的合并 commit SHA 相同，main CI 和发布 workflow 成功。

仓库的 main 规则集要求通过 PR 与 `ci-verify` 合并；每次机器人更新后都以最新检查结果为准。自动版本流程只管理版本、日志、tag 和 Release，不向 npm 发布，也不自动部署服务。

上述批准行为与 `GITHUB_TOKEN` 触发规则见 [GitHub 官方说明](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)。`GITHUB_TOKEN` 创建的 tag/Release 不会自动触发独立的后续发布 workflow；未来增加制品或部署时，可接在同一发布 workflow 的发布成功分支，或另行明确 GitHub App/受限 token 的触发方案。

## 发布后同步

日常开发工作区继续使用 main：

```powershell
git switch main
git pull --ff-only origin main
git fetch origin --tags
node -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version"
```

可用 `git rev-parse 'v1.6.1^{commit}'` 这类命令核对发布版本的源码。tag 对象 SHA 和解引用后的 commit SHA可能不同；源码比对使用后者。

## 检出一个明确的发布版本

在用于版本验收或部署准备的干净工作区执行：

```powershell
npm.cmd run checkout:release -- v1.6.1
```

脚本只 fetch 指定规范标签并检出为 detached HEAD；必须先提交或自行妥善处理本地改动。目标版本若会覆盖本地忽略文件（例如 `server/.env`），脚本拒绝切换并保留文件。它不安装依赖、不构建、不停止或重启服务，也不作为定时拉取 main 的任务使用。

检出后按目标版本自带的命令安装、验证，再由维护者的部署方案启动服务。目标版本提供 `verify` 时可以运行 `npm.cmd ci` 和 `npm.cmd run verify`；已发布的 `v1.6.1` 没有新增的 `verify` 脚本，使用该版本已有的 `typecheck`、`lint`、`test` 命令，再分别执行 `build:client` 和 `build:server`（该版本的合并构建命令依赖 Bash）。检查命令和环境要求以检出的版本文件为准。

当前主线的完整构建输出 `dist/` 和 `dist-server/`。部署时保留根 `package.json`、`server/knowledge/`、`server/.env` 与 `public/models/`，在项目根目录设置 `NODE_ENV=production` 后运行 `npm.cmd start`（`node dist-server/main.js`）。前端静态站点独立部署并将 `/api` 转发到后端；版本检出命令不执行这些步骤。

返回开发工作区时执行 `git switch main` 并更新 main。旧 Bash 入口 `bash scripts/sync.sh` 和 `bash scripts/cloud-pull.sh v1.6.1` 仅兼容转发到上述维护命令；Windows PowerShell 优先使用 `npm.cmd`。
