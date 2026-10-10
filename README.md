# 司农智机 · SRT27

> 本仓库维护 **v1 系列**。当前源码版本以 [package.json](package.json) 为准；版本变化见 [CHANGELOG.md](CHANGELOG.md)，旧版本对照见 [历史记录](docs/version-history.md)，正式发布见 [GitHub Releases](https://github.com/Changjie29/AgriDx-v1/releases)。

目录分工见 [架构说明](docs/architecture.md)，开发与发版见 [发布流程](docs/releasing.md)，资料适用范围和检索协同说明见 [OPERATIONS.md](OPERATIONS.md)。

面向农业机械装备的智能故障诊断 Agent。基于本地 Markdown 知识库 + 大语言模型，为拖拉机、联合收割机等农机提供结构化的故障原因分析、排查步骤与安全维修建议。

> 当前版本为**本地知识库 + LLM 对话**的轻量方案，未接入传感器/麦克风/视觉/CAN 总线。多模态感知、结构仿真、数字孪生等能力均为规划方向。

## 技术栈

- **前端**：React 19 + Vite + TypeScript + Tailwind CSS + React Router + React Three Fiber
- **后端**：Node.js + Express + tsx（ESM）
- **LLM**：Gemini（`gemini-3.6-flash`）/ DeepSeek（`deepseek-v4-flash`），OpenAI 兼容协议
- **知识库**：本地 Markdown，按 `## ` 切块 + 关键词重叠打分，零向量库
- **3D**：Three.js / React Three Fiber，程序化 RoomEnvironment 光照，零 HDR 网络请求

## 快速开始

### 环境要求

- Node.js 24.x
- npm 11.x（与 Node 24 配套）

`.node-version` 与 CI 统一使用 Node 24，根 package 的 `engines` 声明 Node 24 / npm 11。在仓库根目录运行命令。Windows PowerShell 使用 `npm.cmd`；以下示例采用 PowerShell 写法。

### 1. 安装依赖

```powershell
npm.cmd ci
```

### 2. 配置 API Key

编辑 `server/.env`（**该文件永不提交到 Git**，已在 `.gitignore` 中排除）：

```env
# Gemini（有代理环境优先使用；OAuth token 或 API key）
GEMINI_API_KEY=your_gemini_api_key

# DeepSeek（无代理环境优先使用；sk- 开头）
DEEPSEEK_API_KEY=your_deepseek_api_key

# 服务端口（默认 8787）
PORT=8787

# 可选：代理（写在这里也能被识别；服务启动时先加载本文件再读代理变量）
# HTTPS_PROXY=http://127.0.0.1:7890
# HTTP_PROXY=http://127.0.0.1:7890
```

> 两个 key 都配最稳：后端按网络环境自动选主选，失败自动回退。只配一个也能跑。
> 服务启动顺序：先加载 `server/.env`，再读取 `HTTPS_PROXY/https_proxy/HTTP_PROXY/http_proxy` 决定走 Gemini 还是 DeepSeek。

### 3. 启动开发服务

```powershell
npm.cmd run dev
```

- 前端：http://localhost:8080
- 后端：http://localhost:8787
- 健康检查：http://localhost:8787/api/health

### 4. 验证改动

```powershell
npm.cmd run verify        # CI 同款完整检查
npm.cmd run check:version # 单独检查发布文件与运行时版本
npm.cmd run typecheck     # 前后端类型检查
npm.cmd run lint          # ESLint
npm.cmd test              # tsx 直接运行 TypeScript 测试
npm.cmd run test:domain   # 编译后运行测试，不依赖 tsx/esbuild
npm.cmd run build         # 构建 dist/ 和 dist-server/
```

`verify` 依次检查版本、前后端类型、编译后的测试、前后端完整构建、构建产物的运行时版本和 Lint。构建入口为跨平台 Node 脚本 `scripts/build.mjs`，无需 Bash；单独构建可用 `build:client` 或 `build:server`。

`dist/` 是前端静态站点，交给静态服务器或 CDN；`dist-server/` 是后端 ESM 产物。构建后在仓库根目录启动后端：

```powershell
$env:NODE_ENV = "production"
npm.cmd start              # node dist-server/main.js
```

知识库、`server/.env` 和 `public/` 按项目根目录解析，部署时需保留这些运行资源和根 `package.json`。后端不托管 `dist/`，前端站点需将 `/api` 转发到后端。

## LLM 选择策略

后端 `server/llm/router.ts` 按当前网络环境自动选 provider：

| 环境 | 主选 | 回退 |
| --- | --- | --- |
| 检测到 `HTTPS_PROXY` / `https_proxy` / `HTTP_PROXY` / `http_proxy` | Gemini | DeepSeek |
| 无代理变量 | DeepSeek | Gemini |

- 主选未配置时自动交换。
- 主选抛网络/超时/服务端错误时自动回退次选。
- 鉴权错误（401/403）也会尝试另一个，方便排查 key 问题。
- 所有 LLM 失败或输出结构/引用编号校验失败时，后端返回本地资料模式，展示命中章节和出处；无匹配时明确说明没有适用资料，不生成维修结论。
- 20 秒超时。

## RAG 工作流

1. 启动时扫描 `server/knowledge/` 下的 Markdown 资料，跳过 `00_说明/`，仅索引有有效 `agridx-meta` 且启用的资料，按 `##` 二级标题切块。
2. 根据最近六条用户消息和机器选择构造检索上下文；新问题可重置上下文，品牌/型号冲突先要求确认。
3. 按机型、品牌和型号过滤适用资料，再做中文 2-gram 与英文 token 打分；标题命中权重 ×3，最多取 6 个片段，注入时单块正文最多 1200 字符。
4. 后端独占 system prompt，模型按 JSON 协议分别输出资料证据、待验证假设、追问和检查建议。服务端校验结构及引用编号，再组装固定 Markdown 分区。
5. 模型不可用或输出不合格时返回本地资料兜底；模型回答不会自动写入知识库。

前端只发 user/assistant 消息；服务端丢弃客户端 system 消息，保留最近 20 条用户/助手消息。资料不足和机型冲突分别通过 `evidenceMode` 表达。结构和编号校验不等于逐句证据核验，诊断仍需核对资料适用条件。

## 知识库目录

```
server/knowledge/
├── 00_说明/              # 目录约定与维护说明（不参与检索）
├── 01_通用原理/          # 发动机/冷却/润滑/液压/电气/传动/制动/转向
├── 02_农机类型/          # 拖拉机/收割机/插秧机/植保机...
├── 03_新能源农机/        # 电动/混动农机
├── 04_智能农机/          # 无人化/自动驾驶
├── 05_故障代码/          # 各品牌故障码表
├── 06_品牌资料/          # 东方红/雷沃/中联/久保田/约翰迪尔...
├── 07_具体型号/          # 具体型号维修手册
└── 99_待整理/            # 未分类资料
```

知识正文直接放入对应分类目录，检索实现仍位于 `server/knowledge/*.ts`，避免重复嵌套目录。未来接入 PDF/Word/Excel/TXT 时，解析结果仍需携带正文、来源、章节和适用范围元信息。

> 资料必须同时满足三个条件才会参与检索：文件位于 `server/knowledge/` 下（`00_说明/` 除外）、带有 `<!-- agridx-meta: {...} -->` 元信息、且元信息里 `enabled: true`。加载时的扫描/索引/跳过数量与告警可通过 `GET /api/knowledge` 查看；如果告警里出现"缺元信息"或"无 ## 章节"，说明该资料写了但没生效。

## 项目结构

```text
AgriDx-v1/
├── src/                         # React 页面、交互和客户端状态
│   └── hooks/useVersion.ts       # 接口版本与构建版本兜底
├── server/
│   ├── index.ts                 # Express 应用和 HTTP 接口，不监听端口
│   ├── dev.ts / main.ts          # 开发 / 生产入口，监听与优雅退出
│   ├── version.ts               # 启动时读取根 package 的版本
│   ├── logger.ts                # 日志脱敏、分级、缓冲与落盘轮转
│   ├── llm/                     # Provider 适配、代理、超时和切换
│   └── knowledge/
│       ├── *.ts                 # 检索、上下文、提示词和回答校验
│       └── 分类子目录/           # Markdown 知识正文与适用范围元信息
├── shared/                      # 浏览器与服务端共享的声明
├── public/                      # 公开静态资源，包括 models/tractor.glb
├── scripts/
│   ├── dev.mjs / build.mjs       # 跨平台开发与构建
│   ├── verify.mjs / run-tests.mjs # CI 同款验证与编译后测试
│   ├── check-version.mjs        # 版本文件、发布配置与运行时检查
│   ├── sync.mjs / checkout-release.mjs # 分支推送与显式标签检出
│   ├── lib/                     # CLI、Git、发布校验与版本探针共用逻辑
│   └── sync.sh / cloud-pull.sh  # 旧 Bash 入口，转发到 Node 维护命令
├── tests/                       # 检索、回答、接口、版本、日志与维护检查
├── docs/
│   ├── architecture.md          # 目录职责与运行路径
│   ├── releasing.md             # 工作分支、发布 PR 和版本检出
│   └── version-history.md       # 旧标签和 v1 维护线历史
├── .github/                     # ci-verify、release-please 与 PR 模板
├── .node-version                # 本机与 CI 的 Node 主版本
├── package.json / package-lock.json
├── .release-please-manifest.json / release-please-config.json
├── CHANGELOG.md
├── OPERATIONS.md                # 检索协同与资料维护说明
└── README.md
```

前端经 `/api` 使用后端；`shared/` 保持浏览器可用。密钥、模型调用和知识正文读取由 `server/` 管理。详细边界与构建产物说明见 [架构文档](docs/architecture.md)。

## Git 分支

- **`main`**：稳定主分支，开发改动通过 PR 合入；合并前须通过 CI。部署时记录对应的版本标签或完整 commit SHA。
- 开发从最新 `main` 创建短期工作分支，例如 `codex/<任务名>`；提交 PR，使用 `Squash and merge` 合并。PR 标题采用 `feat(scope): ...`、`fix(scope): ...`、`ci(scope): ...` 等格式，最终合并标题与 PR 标题一致。

## 版本号与更新日志（自动）

`package.json` 的 `version` 是发布版本的权威来源。发布 PR 同步 `package-lock.json`、`.release-please-manifest.json`、`CHANGELOG.md` 和 `docs/version-history.md`；版本对照中的当前版本块通过 release-please 的 `extra-files` 配置更新。后端启动时读取并缓存版本，前端页脚请求 `GET /api/version`；接口不可用时标明使用构建版本。更新后端并重启后，展示新版本无需为了版本号单独重建前端。部署可通过 `APP_VERSION` 显式覆盖运行时版本，接口的 `source` 会标明来源。

发布流程：

1. 工作分支以 Conventional Commits 格式的 PR 标题，经 CI 与 Squash 合并进入 `main`。
2. Release Please 工作流自动开一个 `chore(main): release X.Y.Z` 的 PR，内含版本号递增、CHANGELOG 条目和版本对照同步。
3. 维护者批准机器人 PR 的待批准 CI，核对 `ci-verify` 和版本日志后合并；同一发布工作流随后打 tag 并创建 GitHub Release。

注意：release-please 的默认策略是"有 `feat:` 升次版本，其余情况兜底升修订号"，所以纯维护提交（`ci:` / `chore:` / `docs:`）同样会开出版本 PR。版本号是否前进取决于你是否合并那个 PR；需要指定版本时在提交正文写一行 `Release-As: x.y.z`。

CI 与本机的 `npm.cmd run check:version` 共用 `scripts/check-version.mjs`：检查稳定三段版本、上述五处版本信息、重复日志版本与发布配置；已有构建产物时还验证后端运行时版本。完整工作流、机器人 CI 批准和标签检出见 [发布流程](docs/releasing.md)。

## 日志

所有日志经 `server/logger.ts` 统一输出，关键能力：

- **脱敏**：识别 `sk-`/`gsk_`/`AIza`/`xai-` 前缀密钥、`Bearer <token>`、`apiKey=...`、`"token": "..."`，以及对象里的敏感字段值（`token`/`password`/`secret` 等），替换为 `[redacted]` 后再缓冲、输出和落盘。
- **请求 ID**：生成 `X-Request-Id`，或透传由 8–64 个字母、数字、下划线或连字符组成的同名请求头。响应头和访问日志带上 ID，全局 500 错误体也返回 `requestId`。
- **级别**：`LOG_LEVEL=debug|info|warn|error`；4xx 记 `warn`、5xx 记 `error`。
- **格式**：默认可读文本；`LOG_FORMAT=json` 输出单行 JSON，便于采集。
- **落盘**：设置 `LOG_FILE=logs/app.jsonl` 后追加写入，超过 `LOG_MAX_BYTES`（默认 2 MiB）自动轮转为 `app.jsonl.1`。
- **内存缓冲**：保留最近 200 条，`ENABLE_LOG_ENDPOINT=true` 时可通过 `GET /api/logs` 查看。

日志配置在 logger 初始化时读取，请在启动命令的进程环境中设置。例如 PowerShell：

```powershell
$env:LOG_LEVEL = "debug"
$env:LOG_FORMAT = "json"
$env:LOG_FILE = "logs/app.jsonl"
npm.cmd run dev
```

## API

### `GET /api/health`

```json
{
  "ok": true,
  "timestamp": "2026-10-10T01:00:00.000Z",
  "version": "1.6.1",
  "knowledge": { "fileCount": 2, "chunkCount": 26, "scannedFiles": 4, "skippedDisabled": 1 }
}
```

### `GET /api/version`

服务启动时从根 `package.json` 读取并缓存版本；设置 `APP_VERSION` 时使用该覆盖值，`source` 标明实际来源。前端页脚读取这个接口，接口不可用时显示构建版本。版本和资料统计的以下示例值仅用于说明字段，实际以运行进程为准。

```json
{
  "name": "agri-fault-diagnosis",
  "version": "1.6.1",
  "display": "v1.6.1",
  "commit": null,
  "commitShort": null,
  "buildTime": null,
  "environment": "production",
  "source": "/app/package.json",
  "startedAt": "2026-10-10T01:00:00.000Z",
  "uptimeSeconds": 3600,
  "knowledge": { "fileCount": 2, "chunkCount": 26 }
}
```

`commit` / `buildTime` 来自服务进程环境变量 `GIT_COMMIT`（或 `GITHUB_SHA`）和 `BUILD_TIME`；仅执行构建不会把这些值固化到后端产物，部署时需传入。未提供时返回 `null`；`environment` 来自 `NODE_ENV`，默认 `development`。

### `GET /api/knowledge`

知识库自检：哪些资料真正参与检索、哪些被排除、有哪些需要维护者处理的告警。
排查"资料明明在仓库里却检索不到"时先看这个接口。

```json
{
  "fileCount": 2,
  "chunkCount": 26,
  "scannedFiles": 4,
  "skippedDisabled": 1,
  "skippedNoMetadata": 0,
  "skippedInvalidMetadata": 0,
  "root": "/app/server/knowledge",
  "indexedSources": ["02_农机类型/拖拉机检修与常见故障.md", "05_故障代码/约翰迪尔9R-诊断故障码.md"],
  "warnings": ["1 份资料 enabled=false，未参与检索"]
}
```

`scannedFiles` 包含扫描到的全部 Markdown 文件，包括不会索引的 `00_说明/`；`fileCount` 与 `chunkCount` 只统计实际索引。`skippedInvalidMetadata` 还包含读取失败的文件。`warnings` 汇总空知识库、所有资料被排除、缺元信息、未启用和启用资料缺少有效二级章节等情况；元信息 JSON/字段非法或读取失败可结合计数与启动日志排查。

### `GET /api/logs`

默认关闭。设置 `ENABLE_LOG_ENDPOINT=true` 后返回最近日志（已脱敏）。
返回 `{ "status": { ... }, "entries": [ ... ] }`，默认取最近 50 条，按新到旧排列。支持 `?limit=1..200` 与 `?level=debug|info|warn|error`，级别参数表示最低级别。

### `POST /api/chat`

请求体（前端只发 user/assistant；system 由后端拼）：

```json
{
  "messages": [
    { "role": "user", "content": "拖拉机水温过高怎么办？" }
  ],
  "machineType": "拖拉机",
  "brand": "",
  "model": ""
}
```

响应（OpenAI 兼容 + 附加字段）：

```json
{
  "choices": [{ "message": { "role": "assistant", "content": "..." } }],
  "model": "deepseek-v4-flash",
  "provider": "deepseek",
  "fellBack": false,
  "knowledgeChunks": 2
}
```

成功生成模型回答时，还返回 `sources`、`answerMode: "model"` 和 `evidenceMode`。`sources` 记录实际检索来源；`evidenceMode` 为 `references_available`、`general_only` 或 `clarify`，分别表示有候选资料、无适用资料或机型信息冲突。

模型不可用或输出格式不合格时，接口仍返回 HTTP 200 的兼容消息结构，并设置 `answerMode: "local"`、`provider: null`、`fellBack: true`，保留 `sources` 和资料状态。输入校验失败返回 400，限流返回 429；未处理的服务器异常由全局错误处理返回 500。

## 安全

- API Key 仅存于 `server/.env`，前端/构建产物/Git 均不出现。
- CORS 默认允许本地开发源；生产通过 `ALLOWED_ORIGINS` 配置逗号分隔的站点来源。
- 配置代理环境变量时，外部 LLM 请求通过 `undici` 的 `ProxyAgent` 使用代理。
- `/api/chat` 每 IP 每分钟 30 次限流。
- 错误日志只打印 provider 名与错误类别，绝不打印 key。
- Markdown 渲染使用 `react-markdown`（默认不执行 HTML/JS）。

## 当前已实现 vs 规划中

**已实现**

- 本地 Markdown 知识库 + 关键词检索 RAG
- Gemini / DeepSeek 双 Provider，按代理自动选择 + 失败回退
- 后端独占 system prompt，强制结构化输出与禁止编造参数
- 可交互 3D 拖拉机模型（拖拽/缩放/自转/恢复视角）
- 中英双语界面、跟随系统的明暗主题
- 对话历史本地持久化、Markdown 渲染、快捷提问
- 农机类型/品牌/型号可选选择器，用于增强检索
- CORS 白名单、安全头、限流、优雅退出、错误脱敏
- 运行时版本 API 与页脚、知识库索引自检、结构化日志与可选日志接口
- 跨平台构建、编译后测试和 CI 同款完整验证

**规划中（首页已明确标注）**

- 振动/声学/视觉/CAN 总线多模态信号接入
- 有限元模态/应力仿真验证
- 数字孪生诊断-验证闭环
- 真实 PDF/Word/Excel 维修手册解析入库
- 向量检索（当前为关键词重叠，资料量上来后再升级）

## 同步部署

- GitHub：https://github.com/Changjie29/AgriDx-v1
- 开发同步：改动由维护者审阅并提交后，在干净的非 main 分支运行 `npm.cmd run sync`，只推送当前分支，然后创建 PR、通过 CI 并合入 main。
- 版本验收或部署准备：在干净工作区执行 `npm.cmd run checkout:release -- v1.6.1` 这类显式标签检出，获得 detached HEAD。随后按目标版本安装和验证，再由维护者的部署方案启动服务。
- 两个维护命令都不自动提交代码、部署或重启服务；较早标签可能没有新增的 `verify` 命令，完整步骤见 [发布流程](docs/releasing.md)。

---

© 2026 司农智机 SRT27 · 南京农业大学

## 2026-09-26 对话体验优化

- 首页与对话页按路由加载，直接访问 `/chat` 不下载首页的 3D 代码。
- 输入超过 2000 字符时显示计数并禁止发送；中文输入法组词时回车不发送。
- 支持停止等待；清空或离开页面会取消前端请求，并隔离旧请求的完成回调。停止等待不保证服务端模型已经停止生成。
- 仅保存最近 100 条用户/助手消息，恢复时过滤损坏记录和非法展示字段。
- 农机类型使用稳定值，中英文切换保留选择，并兼容历史英文类型。
- 增加输入控件无障碍标签、对话更新播报、动态视口高度及长内容横向滚动。

验证：前后端构建、前端类型检查通过；Lint 无错误（基础按钮组件仍有原有 Fast Refresh 警告）。浏览器验证了双语机型保留、2001 字输入禁发、Shift+Enter 换行、停止等待、清空后新对话与模拟回复显示。请求交互使用临时本机模拟接口验证，未调用真实 LLM；中文输入法组合事件防护尚需在实际输入法中复核。首页 3D 构建块仍有体积告警。
