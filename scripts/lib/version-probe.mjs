/**
 * 版本探针：在独立进程里 import 构建产物中的 version 模块，并输出其运行时版本。
 *
 * 之所以用独立进程 + 独立脚本：
 * - 独立进程 = 真正验证"部署产物能被 Node 加载"，而不是复用当前进程的缓存；
 * - 独立脚本 = 避免 `node -e` 里 argv 下标与转义带来的坑。
 *
 * 用法：node scripts/lib/version-probe.mjs <version.js 的绝对路径>
 */
const target = process.argv[2];
if (!target) {
  console.error('用法：node scripts/lib/version-probe.mjs <version.js 路径>');
  process.exit(2);
}

const { pathToFileURL } = await import('node:url');
const module = await import(pathToFileURL(target).href);
if (typeof module.getAppVersion !== 'function') {
  console.error(`目标模块未导出 getAppVersion：${target}`);
  process.exit(3);
}
process.stdout.write(`${JSON.stringify(module.getAppVersion())}\n`);
