/** 调试用:解码 /api/export 的 tasks doc,打印实体字段 */
import * as Y from 'yjs';
import fs from 'node:fs';

const exp = JSON.parse(fs.readFileSync(process.argv[2] ?? '/tmp/export.json', 'utf8')) as {
  docs: Record<string, string>;
};
const doc = new Y.Doc();
Y.applyUpdate(doc, Buffer.from(exp.docs.tasks ?? '', 'base64'));
for (const [, m] of doc.getMap('items').entries()) {
  const j = (m as Y.Map<unknown>).toJSON() as Record<string, unknown>;
  console.log(
    JSON.stringify({
      title: j.title,
      status: j.status,
      parentId: j.parentId,
      dueAt: j.dueAt ? new Date(j.dueAt as number).toISOString() : null,
      deletedAt: j.deletedAt,
      important: j.important,
      urgent: j.urgent,
      order: j.order,
    }),
  );
}
