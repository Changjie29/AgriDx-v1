/**
 * 生产启动入口。
 *
 * 构建产物：dist-server/main.js
 * 启动方式：node dist-server/main.js
 *
 * 必须在仓库根目录启动：知识库（server/knowledge）与 public/ 都按 process.cwd() 解析。
 */
import app, { VERSION } from './index.js';
import { createLogger } from './logger.js';
import { versionLine } from './version.js';

const log = createLogger('server');
const PORT = Number(process.env.PORT) || 8787;

const server = app.listen(PORT, () => {
  log.info(`服务已启动 http://localhost:${PORT}`);
  log.info(`版本 ${versionLine()}`, { detail: { source: VERSION.source } });
});

const shutdown = (signal: string) => {
  log.info(`收到 ${signal}，正在关闭服务…`);
  server.close(() => process.exit(0));
  // 兜底：5 秒内没关干净就强制退出，避免容器无法回收
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export default app;
