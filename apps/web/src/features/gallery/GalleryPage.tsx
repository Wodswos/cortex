import React from 'react';
import { useNavigate } from 'react-router';
import { Badge } from '@cortex/ui';
import { GALLERIES, GalleryNode, buildImportTasks, countNodes } from '@cortex/core';
import { useCortex, useCortexData } from '@cortex/crdt';

function TreeNode({ node, depth }: { node: GalleryNode; depth: number }) {
  return (
    <div key={node.title}>
      <div
        className="flex items-center gap-2 py-1 text-sm"
        style={{ paddingLeft: depth * 18 }}
      >
        {node.children?.length ? <span className="text-muted">▾</span> : <span className="text-muted/40">·</span>}
        <span className="truncate">{node.title}</span>
        {node.estimateMin != null && <Badge className="!px-1.5 !py-0 !text-[9px]">{node.estimateMin}m</Badge>}
      </div>
      {node.notes && (
        <div className="text-xs text-muted/70" style={{ paddingLeft: depth * 18 + 24 }}>{node.notes}</div>
      )}
      {node.children?.map((c) => <TreeNode key={c.title} node={c} depth={depth + 1} />)}
    </div>
  );
}

export default function GalleryPage() {
  const data = useCortexData();
  const store = useCortex();
  const navigate = useNavigate();
  const g = GALLERIES[0];

  const alreadyImported = data.tasks.some(
    (t) => t.parentId == null && !t.deletedAt && t.status !== 'archived' && t.title === g.title,
  );
  const nodeCount = countNodes(g.tree);

  const importRoadmap = () => {
    const root = store.createTask({ title: g.title, notes: g.description, status: 'todo' });
    const items = buildImportTasks(g.tree, root.id);
    const idByKey = new Map<string, string>([[root.id, root.id]]);
    for (const it of items) {
      const pid = it.parentKey === root.id ? root.id : idByKey.get(it.parentKey);
      if (pid == null) continue;
      const created = store.createTask({
        title: it.title,
        notes: it.notes,
        estimateMin: it.estimateMin,
        parentId: pid,
        order: it.order,
        status: 'todo',
      });
      idByKey.set(it.key, created.id);
    }
    navigate('/tasks');
  };

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 p-4 md:p-6">
      <div>
        <h1 className="text-lg font-semibold">Gallery</h1>
        <p className="text-xs text-muted">选择一个领域的精选成长路线图,一键导入到你的任务工作区。</p>
      </div>

      <div
        className="rounded-2xl border p-4 transition-all"
        style={{ borderColor: `color-mix(in_srgb, ${g.color} 40%, transparent)`, background: `color-mix(in_srgb, ${g.color} 6%, transparent)` }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: g.color }} />
          <span className="text-sm font-semibold">{g.title}</span>
          <Badge>{g.domain}</Badge>
          <span className="text-[10px] text-muted">{nodeCount} 个节点</span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted">{g.description}</p>
        <div className="mt-3 flex gap-2">
          <button
            onClick={importRoadmap}
            disabled={alreadyImported}
            className="inline-flex items-center gap-1.5 rounded-full gradient-bg px-4 py-1.5 text-sm text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          >
            {alreadyImported ? `已导入到我的任务 (${nodeCount})` : '导入到我的任务'}
          </button>
          <button
            onClick={() => navigate('/tasks')}
            className="rounded-full glass px-4 py-1.5 text-sm text-muted transition-colors hover:text-foreground"
          >
            回到任务
          </button>
        </div>
        {alreadyImported && (
          <p className="mt-2 text-xs text-muted">
            已存在同名根任务,如需再次导入请先改名或删除。
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-[var(--border)] p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">内容预览</h2>
          <span className="text-[10px] text-muted/60">章节 → 条目,含预估时长</span>
        </div>
        <div className="flex flex-col">
          {g.tree.map((node) => <TreeNode key={node.title} node={node} depth={0} />)}
        </div>
      </div>
    </div>
  );
}