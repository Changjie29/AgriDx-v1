# 本次修复与运行说明

本补丁基于 AgriDx-v1 提交 e1c7d02。未修改线上服务、API 密钥或模型名称。

## 修复内容

- 检索使用最近六条用户消息，保留症状与后续补充；不把助手推测加入检索。用户说“换个问题”“新问题”“另一台”“换一台”时重置检索上下文。
- 资料增加机器类型、品牌、型号、来源和启用标记；未标注资料不参与检索，需维护者确认适用范围后启用。
- 专用资料要求品牌和型号匹配；用户文本与选择器冲突时只使用通用资料，并提示确认。
- 现有无来源示例文档保留，但停止进入正式回答。现有两份有来源资料未作机械专业审校，仍需专家核验。
- 两个模型均不可用时，接口返回 answerMode=local 和资料章节、出处，不生成维修结论；无匹配则明确说明。
- 正常接口增加 sources 数组；提示词要求只引用实际片段。尚未实现对模型输出逐句核验，不保证模型绝不产生错误引用。

## 启动

在项目根目录运行：

```bash
npm ci
npm run verify   # 版本一致性 + 类型检查 + 编译 + 测试 + Lint
npm run dev
```

浏览器打开 http://localhost:8080；健康检查 http://localhost:8787/api/health。
没有配置密钥也能测试本地资料兜底。真实模型需要由项目维护者在 server/.env 配置可用的服务密钥，并核实 server/llm 中的模型名称确实受服务商支持。不要上传 .env 或密钥。

### 生产构建与启动

```bash
npm run build      # 产出 dist/（前端站点）与 dist-server/（后端 ESM）
npm start          # 等价于 node dist-server/main.js
```

必须在仓库根目录启动：知识库 `server/knowledge/` 与 `public/` 都按 `process.cwd()` 解析。
原先的 `scripts/build.sh` 依赖 Unix shell，已改为跨平台的 `scripts/build.mjs`。

### 发布（自动版本号与更新日志）

1. 用 Conventional Commits 提交。
2. 推到 `main` 后，Release Please 自动开出版本 PR（递增版本号 + CHANGELOG 条目 + 版本对照）。
3. 合并该 PR 后同一工作流自动打 tag、创建 GitHub Release。

版本推进规则：`feat:` 升次版本；带 `!` 或 `BREAKING CHANGE` 升主版本；**其余类型（含 `fix:`、`docs:`、`ci:`、`chore:`）一律兜底升修订号**——所以纯维护提交同样会开出版本 PR，版本号是否前进取决于你是否合并那个 PR。需要指定版本时在提交正文写一行 `Release-As: x.y.z`。详见[历史版本对照](docs/version-history.md#版本号怎么推进)。

不要手工修改 `package.json` 的 version、`.release-please-manifest.json`、`CHANGELOG.md` 的已发布段落——
这些由 release-please 维护；手工改动会被 `node scripts/check-version.mjs` 拦下，或造成重复发版。

版本号只有 `package.json` 一个来源，后端启动时读取并通过 `GET /api/version` 暴露，前端页脚运行时请求该接口。
因此**发布新版本后不需要重新构建前端**，页面上的版本号会立即跟随。

### 日志

设置环境变量即可启用：

```bash
LOG_LEVEL=debug          # debug | info | warn | error（测试环境默认 error）
LOG_FORMAT=json          # 单行 JSON，便于采集
LOG_FILE=logs/app.jsonl  # 追加写入并按 LOG_MAX_BYTES 轮转为 .1
ENABLE_LOG_ENDPOINT=true # 开启 GET /api/logs（默认关闭，仅排查用）
```

日志会自动脱敏（`sk-` 前缀密钥、`Bearer` 凭据、`apiKey=...`、JSON 里的 `"token": "..."` 等形态替换为 `[redacted]`），
每个请求带 `X-Request-Id`，可用 `req=<id>` 把用户反馈对应到具体请求。

## 新资料格式

每份 Markdown 文件第一行添加元信息，例如：

```markdown
<!-- agridx-meta: {"machineType":"拖拉机","brand":"约翰迪尔","models":["9R"],"enabled":true,"sourceUrl":"实际原文网址"} -->
# 资料标题
## 一个完整故障主题
现象、依据、适用条件、检查步骤与注意事项放在同一章节。
```

通用拖拉机资料省略 brand 和 models；其他机器类型请填写前端选择器实际使用的中文值。未审核资料设 enabled=false。重启后端后生效。当前型号严格匹配：9R 系列下具体子型号需确认资料适用后加入 models，不自动猜测兼容性。

## 验收

1. 问“拖拉机冷却液泄漏”，再说“型号是9R，约翰迪尔”，检索应保留冷却液症状。
2. 未指定型号或选择其他品牌时，不应返回9R专用故障码表。
3. 选择器与文本提供不同型号时，回答应要求确认。
4. 未配置模型密钥时，应显示“智能分析暂不可用”和本地资料来源。
5. 与知识库无关的问题不应伪造资料出处。

自动检查：npm test、npm run build、npm run lint。

## 已知限制

这是规则式上下文与关键词检索的第一版修复，不是完整的机型识别器。自然语言型号识别只覆盖已列品牌、9R及明确“型号是…”写法；多次改口可能要求重新确认，建议清空对话并正确选择机型。尚未进行真实模型付费调用、专家诊断评测或线上部署验收。

## 发布与回滚

先在测试环境运行上述命令并验证，再按团队原有部署方式发布。不要直接覆盖服务器密钥。若用本补丁提交发布，可通过 git revert 对应提交回滚，再重新部署。构建产物不包含知识正文，部署时保留 server/knowledge 并从项目根目录启动。

## 本地知识与模型生成内容的协调（第二轮修复）

后端每次先检索，再按 references_available（有候选资料）、general_only（无匹配）、clarify（机型冲突）约束模型。不把命中数量当成资料充分程度或诊断概率。

模型必须返回 JSON，将 evidence（含片段编号）、hypotheses（待验证假设）、questions（最多两项）、checks 分开。服务器校验结构和引用编号，再生成固定 Markdown 分区；现有聊天页面可直接展示。没有资料时仍允许模型提供通用假设与关键追问，禁止编造专用参数。回答不会自动写入知识库。

格式或引用编号检查失败会退回资料列表并明确说明原因。此检查只保证结构与编号有效，不证明资料支持每一句陈述，也不能自动识别所有错误参数；仍需专家核验与真实模型验收。为兼容现有供应商，使用提示词要求 JSON，未依赖特定供应商的结构化输出API；真实模型可能不遵守格式并触发兜底。

测试已扩充为15项，含无资料时模型分析正常返回、非法结构退回本地资料、越界引用、冲突追问与分区转义。当前代码仍配置 Gemini/DeepSeek 供应商；本次没有把供应商改为 GPT，也没有核实线上实际调用哪一款模型。
