const createRequire = require('node:module').createRequire;
const req = createRequire(__filename);
const Y = req('yjs');
const fs = require('fs');
const buf = fs.readFileSync('/tmp/tasks-snapshot.bin');
const doc = new Y.Doc();
Y.applyUpdate(doc, buf);
const items = doc.getMap('items');
console.log('总实体:', items.size);
const byId = new Map();
for (const [id, m] of items.entries()) { const j = m.toJSON(); j.__id = id; byId.set(id, j); }
const kids = new Map();
for (const j of byId.values()) {
  const p = j.deletedAt ? '__del__' : (j.parentId ?? '__root__');
  if (!kids.has(p)) kids.set(p, []);
  kids.get(p).push(j);
}
const show = (j, d) => {
  const mark = j.deletedAt ? '🗑' : '';
  const kind = j.kind === 'node' ? '[S]' : '';
  console.log('  '.repeat(d) + mark + kind + (j.title ?? '(无题)').slice(0, 70) + ' #' + j.__id.slice(-4));
  const c = (kids.get(j.__id) ?? []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const k of c) show(k, d + 1);
};
const roots = (kids.get('__root__') ?? []).filter(j => !j.deletedAt).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
console.log('根数:', roots.length, ' 已删除实体:', (kids.get('__del__') ?? []).length);
for (const r of roots) show(r, 0);
// 追加:导出存活树 JSON(kind/order/标题),供 CDP 种子脚本使用
const tree = roots.map(function toNode(j) {
  const c = (kids.get(j.__id) ?? []).filter(k => !k.deletedAt).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return { t: j.title ?? '', s: j.kind === 'node', children: c.map(toNode) };
});
fs.writeFileSync('/tmp/r17-tree.json', JSON.stringify(tree));
console.log('树已导出 /tmp/r17-tree.json, 根:', tree.length, ' 总节点:', (function cnt(n){return n.children.reduce((a,c)=>a+cnt(c),1)})(  {children:tree}) - 0, JSON.stringify(tree.map(r=>r.t)));
let total = 0; (function walk(n){ total++; n.children.forEach(walk); })({children:tree});
console.log('总节点数:', total);
