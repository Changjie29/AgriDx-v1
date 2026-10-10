> 检索协同修复：新增资料适用范围、用户上下文保留与本地资料兜底。旧版说明中“仅最后一句检索”和“失败统一502”已更新，运行和资料导入请优先阅读 [OPERATIONS.md](OPERATIONS.md)。

# 司农智机 · SRT27

> 本仓库维护 **v1 系列**。当前源码版本以 [package.json](package.json) 为准；版本变化见 [CHANGELOG.md](CHANGELOG.md)，旧版本对照见 [历史记录](docs/version-history.md)，正式发布见 [GitHub Releases](https://github.com/Changjie29/AgriDx-v1/releases)。

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

- Node.js ≥ 20
- npm ≥ 10

### 1. 安装依赖

```bash
npm install
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

```bash
npm run dev
```

- 前端：http://localhost:8080
- 后端：http://localhost:8787
- 健康检查：http://localhost:8787/api/health

### 4. 类型检查 / Lint / 测试 / 构建

```bash
npm run verify      # 一键：版本一致性 + 类型检查 + 编译 + 测试 + Lint（CI 同款）
npm run typecheck   # 前端 tsc
npm run lint        # eslint
npm test            # 全部测试（tsx 直跑 .ts）
npm run test:domain # 编译后运行测试（不依赖 tsx/esbuild，受限环境用这个）
npm run build       # 跨平台构建：dist/（前端）+ dist-server/（后端）
npm start           # 启动构建产物：node dist-server/server/main.js
```

构建产物说明：

- `dist/` 前端静态站点，交给任意静态服务器/CDN。
- `dist-server/` 后端 ESM 产物，Node 可直接运行；**必须在仓库根目录启动**，因为知识库与 `public/` 按 `process.cwd()` 解析。
- `npm run build` 是跨平台 Node 脚本（`scripts/build.mjs`），不再依赖 `sh`。

## LLM 选择策略

后端 `server/llm/router.ts` 按当前网络环境自动选 provider：

| 环境 | 主选 | 回退 |
| --- | --- | --- |
| 检测到 `HTTPS_PROXY` / `https_proxy` / `HTTP_PROXY` / `http_proxy` | Gemini | DeepSeek |
| 无代理变量 | DeepSeek | Gemini |

- 主选未配置时自动交换。
- 主选抛网络/超时/服务端错误时自动回退次选。
- 鉴权错误（401/403）也会尝试另一个，方便排查 key 问题。
- 所有 LLM 失败时，前端统一显示「智能诊断服务暂时无法连接，请稍后重试。」，不暴露 ECONNRESET/ETIMEDOUT 等技术细节。
- 20 秒超时。

## RAG 工作流

1. 启动时扫描 `server/knowledge/` 下所有 `.md` 文件（跳过 `00_说明/`），按 `## ` 二级标题切块。
2. 用户提问时，对用户问题做中文 2-gram + 英文 token 化，与每块做关键词重叠打分，标题命中权重 ×3。
3. 取 top-6 片段（单块超 1200 字符截断），拼入后端独占的 system prompt。
4. system prompt 硬性要求：
   - 禁止编造压力/温度/电压/扭矩/故障码/零件号/油液型号等参数；
   - 资料不足时输出【当前资料不足】并主动追问机型/工况/伴随现象；
   - 结构化输出：【故障现象】【初步判断】【可能原因】【建议排查】【知识依据】【安全提醒】；
   - 用户用什么语言问，就用什么语言答。
5. 前端只发 user/assistant 历史（截最近 20 轮），不发 system message——system prompt 由后端独占。

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

未来接入 PDF/Word/Excel/TXT 时，在 `server/knowledge/retriever.ts` 之上增加解析层即可，接口保持 `chunks: { text, source, heading }[]`。

> 资料必须同时满足三个条件才会参与检索：文件位于 `server/knowledge/` 下（`00_说明/` 除外）、带有 `<!-- agridx-meta: {...} -->` 元信息、且元信息里 `enabled: true`。加载时的扫描/索引/跳过数量与告警可通过 `GET /api/knowledge` 查看；如果告警里出现"缺元信息"或"无 ## 章节"，说明该资料写了但没生效。

## 项目结构

```
SRT27/
├── public/                          # 静态公共资源（构建时原样拷贝到 dist/）
│   └── models/
│       └── tractor.glb              # 拖拉机 3D 模型（前端经 /models/tractor.glb 加载；后端 /api/model/tractor 为同一文件接口）
│
├── src/                              # 前端源码（React 19 + Vite + TypeScript）
│   ├── index.tsx                     # 应用入口（挂载 React + Router）
│   ├── app.tsx                      # 路由表（/ 首页、/chat 对话、* 404）
│   ├── index.css / tailwind-theme.css / typography.css  # 样式与主题变量
│   ├── components/
│   │   ├── Layout.tsx               # 全局布局：顶栏导航 + 主题/语言切换 + Outlet
│   │   ├── TractorViewer.tsx       # 3D 查看器（R3F Canvas + OrbitControls + 自转）
│   │   ├── TractorModel.tsx         # GLB 模型加载（useGLTF + clone 克隆处理）、居中缩放贴地
│   │   ├── SectionDivider.tsx      # 绿色装饰分割线（leaf/dots/line 三种）
│   │   └── ui/                     # shadcn/ui 基础组件（button/card/dialog/textarea）
│   ├── pages/
│   │   ├── HomePage/
│   │   │   ├── HomePage.tsx         # 首页组装（按顺序拼接 8 个 section）
│   │   │   └── sections/            # 首页各区块
│   │   │       ├── HeroSection.tsx          # 首屏：标题 + CTA + 3D 模型
│   │   │       ├── PainPointsSection.tsx    # 行业痛点 + 真实能力卡片
│   │   │       ├── MultimodalSection.tsx    # 多模态信号（标注规划中）
│   │   │       ├── ArchitectureSection.tsx   # 真实四层架构
│   │   │       ├── SimulationSection.tsx     # 3D 已实现 / FEA 与数字孪生规划中
│   │   │       ├── TechRouteSection.tsx      # 六步技术流程
│   │   │       ├── ScenariosSection.tsx      # 拖拉机/收割机/更广农机
│   │   │       └── ClosingSection.tsx       # 底部 CTA
│   │   ├── ChatPage/
│   │   │   └── ChatPage.tsx         # 对话页：历史/快捷提问/农机信息选择器/Provider 显示
│   │   └── NotFoundPage/
│   │       └── NotFoundPage.tsx     # 404
│   ├── data/
│   │   └── content.ts               # 全部页面文案（中英双语）+ pick() 工具
│   ├── hooks/
│   │   ├── useLang.ts               # 中英双语切换（useSyncExternalStore）
│   │   └── use-mobile.ts            # 响应式断点 hook
│   └── lib/
│       └── utils.ts                 # cn() 类名合并
│
├── server/                           # 后端（Node.js + Express + tsx，ESM）
│   ├── index.ts                     # 构建 Express 应用（不监听端口，便于测试）
│   ├── main.ts                      # 生产入口：监听端口 + 优雅退出
│   ├── dev.ts                       # 开发入口（tsx watch 启动）
│   ├── version.ts                   # 版本唯一来源：运行时读取 package.json
│   ├── logger.ts                    # 结构化日志：脱敏 + 级别 + 环形缓冲 + 落盘轮转
│   ├── .env                         # 本地环境变量（永不提交 Git）
│   │
│   ├── llm/                         # LLM Provider 层（按代理自动选模型）
│   │   ├── types.ts                 # Provider 接口 / ChatResult / ProviderError
│   │   ├── http.ts                  # fetchWithTimeout(20s) + detectProxy()
│   │   ├── openai-compatible.ts     # 通用 OpenAI 兼容 chat/completions 工厂
│   │   ├── gemini.ts                # Gemini provider（gemini-3.6-flash）
│   │   ├── deepseek.ts              # DeepSeek provider（deepseek-v4-flash）
│   │   └── router.ts                # 单例：有代理→Gemini，无代理→DeepSeek，失败 fallback
│   │
│   └── knowledge/                   # 本地知识库 + 轻量 RAG
│       ├── retriever.ts             # 启动扫描 .md、按 ## 切块、关键词打分、top-K
│       ├── systemPrompt.ts          # buildSystemPrompt（后端独占 system prompt）
│       ├── 00_说明/                 # 目录约定（不参与检索）
│       ├── 01_通用原理/             # 发动机/冷却/润滑/液压/电气/传动...
│       ├── 02_农机类型/             # 拖拉机/收割机/插秧机...
│       ├── 03_新能源农机/           # 电动/混动农机
│       ├── 04_智能农机/             # 无人化/自动驾驶
│       ├── 05_故障代码/             # 各品牌故障码表
│       ├── 06_品牌资料/             # 东方红/雷沃/久保田/约翰迪尔...
│       ├── 07_具体型号/             # 具体型号维修手册
│       └── 99_待整理/              # 未分类资料
│
├── shared/                           # 前后端共享类型
│   ├── plugin-types.ts              # 插件/扩展类型定义
│   └── capabilities/                # 能力声明
│
├── scripts/
│   ├── dev.mjs                      # 同时启动前端 Vite + 后端 tsx
│   ├── build.mjs                    # 跨平台构建（取代 Unix-only build.sh）
│   ├── verify.mjs                   # 一键验证（CI 与本机同款）
│   ├── run-tests.mjs                # 编译后运行测试（不依赖 tsx/esbuild）
│   ├── check-version.mjs            # 版本号一致性检查（CI 拦截漂移）
│   ├── lib/build-utils.mjs          # CLI 解析共用工具
│   ├── cloud-pull.sh               # 云电脑上执行的 git pull 脚本
│   └── sync.sh                      # 本地提交并推送 main
│
├── index.html                        # Vite HTML 入口
├── package.json                     # 依赖与 scripts（dev/typecheck/lint/build）
├── vite.config.ts                   # Vite 配置（代理 /api → 8787）
├── tsconfig.app.json                # 前端 TS 配置
├── tsconfig.server.json             # 后端 TS 配置
├── tsconfig.node.json               # Vite/Node 侧 TS 配置
├── eslint.config.mjs                # ESLint 配置
├── components.json                  # shadcn/ui 配置
└── README.md
```

## Git 分支

- **`main`**：稳定主分支，开发改动通过 PR 合入；合并前须通过 CI。部署时记录对应的版本标签或完整 commit SHA。
- 开发从最新 `main` 创建短期工作分支，例如 `codex/<任务名>`；提交 PR，使用 `Squash and merge` 合并。PR 标题采用 `feat(scope): ...`、`fix(scope): ...`、`ci(scope): ...` 等格式，最终合并标题与 PR 标题一致。

## 版本号与更新日志（自动）

版本号只有一个来源：`package.json` 的 `version`。`package-lock.json`、`.release-please-manifest.json`、`CHANGELOG.md` 和 `docs/version-history.md` 由发布流程同步；后端 `GET /api/version` 与前端页脚在运行时读取，因此发布新版本后不需要重新构建前端。各位置的维护者、版本推进规则和版本对照表统一见 [历史版本对照](docs/version-history.md#版本号是怎么自动更新的)。

发布流程：

1. 用 Conventional Commits 提交并推送到 `main`。
2. Release Please 工作流自动开一个 `chore(main): release X.Y.Z` 的 PR，内含版本号递增、CHANGELOG 条目和版本对照同步。
3. 合并该 PR 后，同一工作流自动打 tag 并创建 GitHub Release。

注意：release-please 的默认策略是"有 `feat:` 升次版本，其余情况兜底升修订号"，所以纯维护提交（`ci:` / `chore:` / `docs:`）同样会开出版本 PR。版本号是否前进取决于你是否合并那个 PR；需要指定版本时在提交正文写一行 `Release-As: x.y.z`。

CI 会运行 `node scripts/check-version.mjs`：`package.json`、`package-lock.json`、manifest、CHANGELOG、版本对照文档中任意一处不一致就会失败，避免"发了新版本但日志没更新"。

## 日志

所有日志经 `server/logger.ts` 统一输出，关键能力：

- **脱敏**：`sk-`/`gsk_`/`AIza`/`xai-` 前缀密钥、`Bearer <token>`、`apiKey=...`、`"token": "..."`，以及对象里字段名敏感的值（`token`/`password`/`secret` 等）都会被替换为 `[redacted]`，落盘前后都不会出现明文密钥。
- **请求 ID**：每个请求生成 `X-Request-Id`（可用同名字段透传），访问日志与错误响应体都会带上，便于把用户反馈对应到日志。
- **级别**：`LOG_LEVEL=debug|info|warn|error`；4xx 记 `warn`、5xx 记 `error`。
- **格式**：默认可读文本；`LOG_FORMAT=json` 输出单行 JSON，便于采集。
- **落盘**：设置 `LOG_FILE=logs/app.jsonl` 后追加写入，超过 `LOG_MAX_BYTES`（默认 2 MiB）自动轮转为 `app.jsonl.1`。
- **内存缓冲**：保留最近 200 条，`ENABLE_LOG_ENDPOINT=true` 时可通过 `GET /api/logs` 查看。

```bash
# 示例
LOG_LEVEL=debug LOG_FORMAT=json LOG_FILE=logs/app.jsonl npm run dev
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

版本号的唯一来源是 `package.json`，服务启动时读取，因此不会与 CHANGELOG/发布标签漂移。
前端页脚就是从这个接口取版本，**发布新版本后无需重新构建前端**。

```json
{
  "name": "agri-fault-diagnosis",
  "version": "1.6.1",
  "display": "v1.6.1",
  "commit": "0941c660837496edcf1c12793b42d79f98cc55d3",
  "commitShort": "0941c66",
  "buildTime": "2026-10-09T12:30:00.000Z",
  "environment": "production",
  "source": "/app/package.json",
  "startedAt": "2026-10-10T01:00:00.000Z",
  "uptimeSeconds": 3600,
  "knowledge": { "fileCount": 2, "chunkCount": 26 }
}
```

`commit` / `buildTime` 来自构建时注入的环境变量（`GIT_COMMIT` / `GITHUB_SHA` / `BUILD_TIME`），
本地运行取不到时如实返回 `null`，不会伪造提交号。

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
  "indexedSources": ["02_农机类型/拖拉机检修与常见故障.md", "05_故障代码/约翰迪尔9R-诊断故障码.md"],
  "warnings": ["1 份资料 enabled=false，未参与检索"]
}
```

### `GET /api/logs`

默认关闭。设置 `ENABLE_LOG_ENDPOINT=true` 后返回最近日志（已脱敏）。
支持 `?limit=1..200` 与 `?level=debug|info|warn|error`。

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

失败时统一返回 HTTP 502：

```json
{ "error": "智能诊断服务暂时无法连接，请稍后重试。", "code": "llm_unavailable" }
```

## 安全

- API Key 仅存于 `server/.env`，前端/构建产物/Git 均不出现。
- CORS 白名单仅允许本地开发源；生产可按需扩展。
- 所有外部 LLM 请求经 `undici` 的 `ProxyAgent` 走系统代理。
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

**规划中（首页已明确标注）**

- 振动/声学/视觉/CAN 总线多模态信号接入
- 有限元模态/应力仿真验证
- 数字孪生诊断-验证闭环
- 真实 PDF/Word/Excel 维修手册解析入库
- 向量检索（当前为关键词重叠，资料量上来后再升级）

## 同步部署

- GitHub：https://github.com/Changjie29/AgriDx-v1
- 本地工作区：clone 仓库后在根目录执行 `npm install` 即可开发，无需额外配置路径
- 同步方式：本地改动提交并推送工作分支，创建 PR，通过 CI 后合并到 `main`；云环境拉取经验证的代码，记录部署的版本或 commit SHA。

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
