import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadKnowledgeBase, stats, indexedSources, retrieve } from '../server/knowledge/retriever.js';

/** 在临时目录里搭一个知识库，避免依赖仓库当前资料 */
function withKb(files: Record<string, string>, run: (root: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agridx-kb-'));
  const previous = process.env.KB_ROOT;
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf-8');
    }
    process.env.KB_ROOT = dir;
    run(dir);
  } finally {
    if (previous === undefined) delete process.env.KB_ROOT; else process.env.KB_ROOT = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const enabledDoc = (heading: string) =>
  `<!-- agridx-meta: {"machineType": "拖拉机", "enabled": true} -->\n# 标题\n\n## ${heading}\n\n- 检查散热器与节温器\n`;

test('已启用且带元信息的资料会被索引', () => {
  withKb({ '01_通用原理/冷却.md': enabledDoc('冷却系统检查') }, () => {
    const result = loadKnowledgeBase();
    assert.equal(result.scannedFiles, 1);
    assert.equal(result.fileCount, 1);
    assert.equal(result.chunkCount, 1);
    assert.deepEqual(result.warnings, []);
    assert.ok(indexedSources().some((s) => s.includes('冷却.md')));
    assert.ok(retrieve('散热器 节温器').length > 0);
  });
});

test('缺少元信息的资料不参与检索，但会被计数并告警', () => {
  withKb({ '01_通用原理/无元信息.md': '# 标题\n\n## 章节\n\n- 内容\n' }, () => {
    const result = loadKnowledgeBase();
    assert.equal(result.scannedFiles, 1);
    assert.equal(result.fileCount, 0);
    assert.equal(result.skippedNoMetadata, 1);
    assert.ok(result.warnings.some((w) => w.includes('缺少')));
  });
});

test('enabled=false 的资料被排除且计数', () => {
  withKb({ '01_通用原理/未审核.md': '<!-- agridx-meta: {"machineType": "拖拉机", "enabled": false} -->\n# 标题\n\n## 章节\n\n- 内容\n' }, () => {
    const result = loadKnowledgeBase();
    assert.equal(result.skippedDisabled, 1);
    assert.equal(result.fileCount, 0);
  });
});

test('元信息非法 JSON 被跳过且不抛异常', () => {
  withKb({ '01_通用原理/坏元信息.md': '<!-- agridx-meta: {not json} -->\n# 标题\n\n## 章节\n\n- 内容\n' }, () => {
    const result = loadKnowledgeBase();
    assert.equal(result.skippedInvalidMetadata, 1);
    assert.equal(result.fileCount, 0);
  });
});

test('元信息字段类型错误（models 不是数组）被跳过', () => {
  withKb({ '01_通用原理/类型错.md': '<!-- agridx-meta: {"machineType": "拖拉机", "enabled": true, "models": "9R"} -->\n# 标题\n\n## 章节\n\n- 内容\n' }, () => {
    const result = loadKnowledgeBase();
    assert.equal(result.skippedInvalidMetadata, 1);
    assert.equal(result.fileCount, 0);
  });
});

test('已启用但没有 ## 章节时告警且不索引', () => {
  withKb({ '01_通用原理/无章节.md': '<!-- agridx-meta: {"machineType": "拖拉机", "enabled": true} -->\n# 标题\n\n正文没有二级标题\n' }, () => {
    const result = loadKnowledgeBase();
    assert.equal(result.fileCount, 0);
    assert.ok(result.warnings.some((w) => w.includes('## 章节')));
  });
});

test('知识库目录为空时给出明确告警（而不是静默无资料）', () => {
  withKb({}, () => {
    const result = loadKnowledgeBase();
    assert.equal(result.scannedFiles, 0);
    assert.ok(result.warnings.some((w) => w.includes('未扫描到任何 .md 文件')));
  });
});

test('00_说明 下的 README 不参与检索', () => {
  withKb({ '00_说明/README.md': enabledDoc('说明章节') }, () => {
    const result = loadKnowledgeBase();
    assert.equal(result.scannedFiles, 1);
    assert.equal(result.fileCount, 0);
  });
});

test('stats() 暴露扫描/索引/跳过数量，便于自检', () => {
  withKb(
    {
      '01_通用原理/启用.md': enabledDoc('甲章节'),
      '01_通用原理/停用.md': '<!-- agridx-meta: {"machineType": "拖拉机", "enabled": false} -->\n# 标题\n\n## 乙章节\n\n- 内容\n',
    },
    (root) => {
      loadKnowledgeBase();
      const current = stats();
      assert.equal(current.scannedFiles, 2);
      assert.equal(current.fileCount, 1);
      assert.equal(current.chunkCount, 1);
      assert.equal(current.skippedDisabled, 1);
      assert.equal(path.resolve(current.root), path.resolve(root));
    },
  );
});

test('仓库自带知识库可正常加载，且被排除的示例资料不参与检索', () => {
  delete process.env.KB_ROOT;
  const result = loadKnowledgeBase();
  // 仓库内应有已启用资料；若这条失败，说明知识库目录或元信息被破坏
  assert.ok(result.fileCount >= 2, `应有至少 2 份已启用资料，实际 ${result.fileCount}`);
  assert.ok(result.chunkCount > 0);
  assert.equal(result.skippedInvalidMetadata, 0);
  // 示例资料 enabled=false，不应出现在索引来源里
  assert.ok(!indexedSources().some((s) => s.includes('通用故障诊断')), '示例资料不应被索引');
});
