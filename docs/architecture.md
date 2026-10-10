# 目录与架构边界

应用保持一个仓库、一个根 package、一个产品版本。前端与后端共同发布，知识资料随对应源码版本保留。目录调整保持接口和资料适用范围的含义，历史版本见 [version-history.md](version-history.md)，日常发布见 [releasing.md](releasing.md)。

## 目录分工

| 目录 | 职责 | 依赖边界 |
|---|---|---|
| `src/` | React 页面、交互、展示和客户端状态 | 经 `/api` 调用服务端；共享声明从 `shared/` 引入 |
| `server/` | Express 接口、输入校验、模型调用、资料检索、回答组装、版本信息与日志 | 管理服务密钥、文件系统和外部模型请求 |
| `shared/` | 前后端都可使用的类型和能力声明 | 保持浏览器可用，避免引入 Node 文件系统、服务密钥或服务端副作用 |
| `server/llm/` | Provider 适配、代理、超时与模型切换 | 向服务端提供统一模型调用结果 |
| `server/knowledge/*.ts` | 上下文、索引、检索、提示词和回答校验 | 资料路径与引用由服务端维护，回答不会写回知识正文 |
| `server/knowledge/` 分类子目录 | 经适用范围标注的 Markdown 资料 | 按机器类型、品牌、型号和启用标记进入检索 |
| `public/` | 前端静态资源，如本地 3D 模型 | 随客户端构建复制，内容可被浏览器直接访问 |
| `scripts/` | 跨平台开发、构建、测试、版本检查、分支同步和发布版本检出 | 共用 Node 入口和 `lib/` 工具；Git 维护操作独立于服务部署 |
| `tests/` | 检索、回答、接口、版本、日志与维护逻辑的自动检查 | 测试使用本地模拟，实际模型验收另行安排 |
| `docs/` | 架构、维护和历史版本说明 | 不作为故障诊断资料参与检索 |
| `.github/` | CI、发布工作流和 PR 模板 | CI 使用 `ci-verify` 检查，发布由 release-please 提交 PR |

`server/index.ts` 构建 Express 应用，不监听端口，供测试直接导入；`dev.ts` 与 `main.ts` 分别负责开发和生产监听及优雅退出。`version.ts` 启动时查找根 `package.json` 并缓存版本，允许 `APP_VERSION` 覆盖；`logger.ts` 负责脱敏、分级、环形缓冲和可选 JSONL 落盘轮转。

`server/knowledge/` 当前同时容纳检索代码与资料。分类子目录用于资料，根目录的 TypeScript 文件用于实现，保留检索入口与运行路径。

## 资料目录

以下为分类约定；尚无资料的分类目录可按需建立。

```text
server/knowledge/
├── retriever.ts / context.ts / systemPrompt.ts
├── answer.ts / fallback.ts
├── 00_说明/                 维护说明，不参与检索
├── 01_通用原理/
├── 02_农机类型/
│   └── 拖拉机检修与常见故障.md
├── 03_新能源农机/
├── 04_智能农机/
├── 05_故障代码/
│   └── 约翰迪尔9R-诊断故障码.md
├── 06_品牌资料/
├── 07_具体型号/
└── 99_待整理/
```

新资料直接放入对应分类目录，路径从知识库根目录开始计算，避免重复创建 `server/knowledge/server/knowledge/`。资料移动后核对 `source` 引用、Markdown 链接和检索结果。

每份可参与检索的资料包含 `agridx-meta` 元信息；无元信息或 `enabled` 未设为 `true` 的资料保留在磁盘但不进入回答。品牌与型号限定资料必须匹配相应上下文。资料格式与审核要求见 [运行与资料维护说明](../OPERATIONS.md#新资料格式)。

`GET /api/knowledge` 返回实际索引文件与片段、扫描与跳过计数、知识库路径、来源列表和告警；`/api/health` 与 `/api/version` 也包含索引统计。扫描数包含 `00_说明/`，实际索引不包含它。读取失败与非法元信息进入 `skippedInvalidMetadata`，相关细节可在启动日志核对。

## 请求路径

1. 前端提交用户/助手消息和机器信息；API Key 仅由服务端读取。
2. 服务端验证输入，丢弃客户端的 system 消息，保留最近 20 条用户/助手消息。
3. 检索上下文取最近的用户信息，并处理新问题重置、机器选择与文本冲突。
4. 先按资料适用范围过滤，再用中文 2-gram 和英文 token 检索，最多注入 6 个资料片段。
5. 模型输出经结构和引用编号校验后，分别展示资料依据、待验证分析、追问和检查建议。
6. 模型不可用或输出不合格时，接口返回本地资料模式，保留来源说明。

接口通过 `sources`、`answerMode` 和 `evidenceMode` 表达资料与回答状态。检索命中和引用编号有效都不代表诊断已确认；机械专业审核和真实模型验收仍是独立环节。

## 构建与运行

- 本机与 CI 使用 `.node-version` 的 Node 24，配套 npm 11；根 package 的 `engines` 声明同一范围。
- `npm run build` 通过 `scripts/build.mjs` 顺序执行客户端和服务端构建，输出为 `dist/` 与 `dist-server/`；`build:client` 和 `build:server` 可分别执行，不依赖 Bash。
- `tsconfig.server.json` 的 `rootDir` 为 `server`，生产入口输出为 `dist-server/main.js`。设置 `NODE_ENV=production` 后，从项目根运行 `npm start`；默认端口为 8787。
- Markdown 资料不由 TypeScript 构建复制；部署需保留根 `package.json`、`server/knowledge/`、`server/.env` 和 `public/models/`。资料、环境文件和模型资源按项目根目录解析。
- 后端提供 API，不托管前端 `dist/`；前端交给静态服务器或 CDN，并转发 `/api` 请求。生产来源可通过 `ALLOWED_ORIGINS` 配置。
- `npm run dev` 启动 Vite 和 tsx 监视服务；`npm run test:domain` 编译后用 Node 执行测试。`verify` 覆盖版本、前后端类型、编译后测试、完整构建、运行时版本复检和 Lint。
- `GET /api/version` 提供版本、进程启动时间、运行时间和资料统计。前端页脚优先读取接口，失败时显示构建版本；提交 SHA 和构建时间需在服务进程环境中提供，不固化到后端编译产物。
- 日志设置通过进程环境提供；请求响应头和访问日志携带 `X-Request-Id`。`GET /api/logs` 仅在 `ENABLE_LOG_ENDPOINT=true` 时返回日志状态与最近脱敏记录。
- `npm run sync` 只推送已提交的工作分支，不附带标签；`npm run checkout:release -- vX.Y.Z` 只获取并检出指定标签，保护本地忽略文件。旧 Bash 入口兼容转发，两者均不部署或重启服务。
- 发布 PR 同步 package、lockfile、manifest、更新日志和历史文档中的版本块；`check:version` 使用统一发布校验与运行时检查，具体操作见 [发布与维护流程](releasing.md)。
