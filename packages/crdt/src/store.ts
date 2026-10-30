import * as Y from 'yjs';
import { toBase64, fromBase64 } from 'lib0/buffer';
import {
  CortexData,
  DEFAULT_SETTINGS,
  EMPTY_DATA,
  Habit,
  HabitLog,
  ID,
  ScheduleEvent,
  Settings,
  Tag,
  Task,
  TaskLink,
  TaskStatus,
  Priority,
  FocusSession,
  newId,
  renumberSiblings,
  quadrantFields,
  isStructural,
  isProject,
  newOrder,
  normalizeTaskForest,
  buildChildrenMap,
  canReparent,
  validateCortexData,
  CortexSnapshot,
  Review,
  ReviewPeriod,
  reviewFacts,
  reviewId,
  validReviewPeriod,
} from '@cortex/core';

/**
 * 数据布局(7 个扁平 Y.Doc,见 docs/DEVLOG.md「扁平 doc」决策):
 *   root     → settings(Y.Map) + tags(Y.Map)
 *   tasks    → items: Y.Map<id, Y.Map<field, value>>
 *   events / links / sessions / habits / habitLogs → 同构
 * 领域代码只碰 CortexData 普通对象;Yjs 细节封闭在本包内。
 */

export const DOC_IDS = ['root', 'tasks', 'events', 'links', 'sessions', 'habits', 'habitLogs'] as const;
export type DocId = (typeof DOC_IDS)[number];

function now(): number {
  return Date.now();
}

type EntityDoc<T> = {
  doc: Y.Doc;
  items: Y.Map<Y.Map<unknown>>;
  toEntity(ymap: Y.Map<unknown>): T | null;
};

export class CortexStore {
  readonly userId: string;
  readonly docs: Record<DocId, Y.Doc>;
  private listeners = new Set<() => void>();
  private scheduled = false;
  private cache: CortexData | null = null;
  private unsubs: (() => void)[] = [];
  /** 每 doc 一个撤销管理器(root 同时盯 settings/tags);hub 维护跨 doc 的撤销顺序 */
  private undoManagers = new Map<DocId, Y.UndoManager>();
  private undoSeq: { id: DocId; kind: 'undo' | 'redo' }[] = [];
  private lastLocalDoc: DocId | null = null;
  private undoSuspended = false;
  private collectionCache = new Map<DocId, unknown>();

  /** 每当任何 doc 变化时回调(用于 sync 客户端感知) */
  onDocUpdate: (docId: DocId, update: Uint8Array, origin: unknown) => void = () => {};

  /** Assigned by the browser persistence adapter; resolves after queued writes commit. */
  flushPersistence: () => Promise<void> = async () => {};

  constructor(userId: string, docs?: Record<DocId, Y.Doc>) {
    this.userId = userId;
    this.docs =
      docs ??
      Object.fromEntries(DOC_IDS.map((id) => [id, new Y.Doc()])) as Record<DocId, Y.Doc>;
    for (const id of DOC_IDS) {
      const doc = this.docs[id];
      const handler = (update: Uint8Array, origin: unknown) => {
        this.collectionCache.delete(id);
        this.scheduleEmit();
        this.onDocUpdate(id, update, origin);
      };
      doc.on('update', handler);
      this.unsubs.push(() => doc.off('update', handler));
    }
    this.setupUndo();
  }

  destroy(): void {
    for (const u of this.unsubs) u();
    for (const m of this.undoManagers.values()) m.destroy();
    this.undoManagers.clear();
    this.undoSeq = [];
    this.listeners.clear();
  }

  // ---------- 撤销 / 重做 ----------
  //
  // 每个 doc 挂一个 Y.UndoManager,默认只追踪 origin=null 的事务 —— 恰好是本store
  // 的本地写入(远端同步 origin=REMOTE、indexeddb 恢复 origin=provider,均不追踪,
  // 所以「别人改的/重放的历史」不会被 ⌘Z 撤掉)。7 个 manager 各有独立栈,顺序靠
  // undoSeq 记账:每次入栈记一条,pop 事件删一条;undo/redo 时从尾部找最近的可执行
  // 条目(对应栈已空的自愈清除),保证跨 doc 也能按用户操作的先后回退。

  private setupUndo(): void {
    for (const id of DOC_IDS) {
      const before = (transaction: Y.Transaction) => {
        if (transaction.origin !== null || this.undoSuspended) return;
        if (this.lastLocalDoc !== id) this.stopUndoCapture();
        this.lastLocalDoc = id;
        for (const manager of this.undoManagers.values()) if (manager.redoStack.length) manager.clear(false, true);
      };
      this.docs[id].on('beforeTransaction', before);
      this.unsubs.push(() => this.docs[id].off('beforeTransaction', before));
      // scope 传整个 doc:该 doc 上所有本地改动都可撤销(root 天然覆盖 settings + tags)
      const manager = new Y.UndoManager(this.docs[id], { captureTimeout: 500 });
      manager.on('stack-item-added', (ev) => {
        this.undoSeq.push({ id, kind: (ev as { type: 'undo' | 'redo' }).type });
      });
      manager.on('stack-item-popped', (ev) => {
        const kind = (ev as { type: 'undo' | 'redo' }).type;
        for (let i = this.undoSeq.length - 1; i >= 0; i--) {
          if (this.undoSeq[i]!.id === id && this.undoSeq[i]!.kind === kind) {
            this.undoSeq.splice(i, 1);
            return;
          }
        }
      });
      manager.on('stack-cleared', (ev) => {
        const { undoStackCleared, redoStackCleared } = ev as { undoStackCleared?: boolean; redoStackCleared?: boolean };
        this.undoSeq = this.undoSeq.filter(
          (e) => !((e.id === id && undoStackCleared && e.kind === 'undo') || (e.id === id && redoStackCleared && e.kind === 'redo')),
        );
      });
      this.undoManagers.set(id, manager);
    }
  }

  /** 撤销最近一次本地修改(跨 doc);成功返回 true */
  undo(): boolean {
    this.lastLocalDoc = null;
    for (let i = this.undoSeq.length - 1; i >= 0; i--) {
      const e = this.undoSeq[i]!;
      if (e.kind !== 'undo') continue;
      const m = this.undoManagers.get(e.id)!;
      if (m.undoStack.length === 0) {
        this.undoSeq.splice(i, 1); // 脏账(合并入栈时一条对多条),自愈清除
        continue;
      }
      m.undo();
      return true;
    }
    return false;
  }

  /** 重做(⌘⇧Z / ⌘Y) */
  redo(): boolean {
    this.lastLocalDoc = null;
    for (let i = this.undoSeq.length - 1; i >= 0; i--) {
      const e = this.undoSeq[i]!;
      if (e.kind !== 'redo') continue;
      const m = this.undoManagers.get(e.id)!;
      if (m.redoStack.length === 0) {
        this.undoSeq.splice(i, 1);
        continue;
      }
      m.redo();
      return true;
    }
    return false;
  }

  canUndo(): boolean {
    for (const m of this.undoManagers.values()) if (m.undoStack.length > 0) return true;
    return false;
  }

  canRedo(): boolean {
    for (const m of this.undoManagers.values()) if (m.redoStack.length > 0) return true;
    return false;
  }

  /** 切断当前撤销单元:下一个写入不再并入(如拖拽结束、提交标题、批量删除完) */
  stopUndoCapture(): void {
    for (const m of this.undoManagers.values()) m.stopCapturing();
  }

  /** 导入/迁移类批量写入不可撤销:暂停追踪,结束后清空撤销栈 */
  private withUndoSuspended<T>(fn: () => T): T {
    this.undoSuspended = true;
    for (const m of this.undoManagers.values()) m.removeTrackedOrigin(null);
    try {
      return fn();
    } finally {
      for (const m of this.undoManagers.values()) {
        m.addTrackedOrigin(null);
        m.clear();
      }
      this.undoSeq = [];
      this.lastLocalDoc = null;
      this.undoSuspended = false;
    }
  }

  // ---------- 订阅与快照 ----------

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getData = (): CortexData => {
    if (!this.cache) this.cache = this.derive();
    return this.cache;
  };

  private scheduleEmit(): void {
    this.cache = null; // 同步失效:getData() 立即可见最新数据
    if (this.scheduled) return;
    this.scheduled = true;
    const flush = () => {
      if (!this.scheduled) return; // 双通道(rAF+timer)只生效一次
      this.scheduled = false;
      for (const fn of this.listeners) fn();
    };
    // rAF 优先(前台节流到帧率);
    // setTimeout 兜底——无头浏览器/后台标签页里 rAF 不触发,数据更新仍要送达 UI(见 DEVLOG)
    const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => void }).requestAnimationFrame;
    if (typeof raf === 'function') raf(() => flush());
    setTimeout(flush, 150);
  }

  private derive(): CortexData {
    const cached = <T>(id: DocId, derive: () => T): T => {
      if (!this.collectionCache.has(id)) this.collectionCache.set(id, derive());
      return this.collectionCache.get(id) as T;
    };
    const tasks = cached('tasks', () => normalizeTaskForest(collect<Task>(this.docs.tasks, defaultsTask)));
    const events = cached('events', () => collect<ScheduleEvent>(this.docs.events, defaultsEvent));
    const links = cached('links', () => collect<TaskLink>(this.docs.links, defaultsLink));
    const sessions = cached('sessions', () => collect<FocusSession>(this.docs.sessions, defaultsSession));
    const habits = cached('habits', () => collect<Habit>(this.docs.habits, defaultsHabit));
    const habitLogs = cached('habitLogs', () => collect<HabitLog>(this.docs.habitLogs, defaultsLog));
    const tags = collect<Tag>(this.docs.root.getMap('tags'), defaultsTag);
    const reviews = cached('root', () => this.collectReviews());

    const settingsMap = this.docs.root.getMap<unknown>('settings');
    const settings: Settings = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(settings) as (keyof Settings)[]) {
      const v = settingsMap.get(key);
      if (v == null) continue;
      // Y.Map 里写的数组会变成 Y.Array,读出来要转回普通数组
      (settings as unknown as Record<string, unknown>)[key] = v instanceof Y.Array ? v.toArray() : v;
    }
    if (settings.pomodoro == null) settings.pomodoro = DEFAULT_SETTINGS.pomodoro;
    else settings.pomodoro = { ...DEFAULT_SETTINGS.pomodoro, ...settings.pomodoro };

    return { tasks, events, links, sessions, habits, habitLogs, tags, reviews, settings };
  }

  // Flat deterministic field keys let two devices start the same day's review concurrently
  // without racing to replace a nested Y.Map and losing one device's different fields.
  private collectReviews(): Review[] {
    const rows = new Map<string, Record<string, unknown>>();
    const allowed = new Set(['kind', 'periodStart', 'periodEnd', 'ownerId', 'createdAt', 'updatedAt', 'highlights', 'friction', 'nextSteps', 'facts', 'completedAt']);
    for (const [key, value] of this.docs.root.getMap('reviewFields')) {
      const split = key.indexOf('/');
      if (split < 0) continue;
      const id = key.slice(0, split), field = key.slice(split + 1);
      if (!/^(daily|weekly)_\d{4}-\d{2}-\d{2}$/.test(id) || !allowed.has(field)) continue;
      const row = rows.get(id) ?? { id, highlights: '', friction: '', nextSteps: '', facts: null, completedAt: null };
      row[field] = value;
      rows.set(id, row);
    }
    return [...rows.values()].filter(row => row.kind && row.periodStart && row.periodEnd) as unknown as Review[];
  }

  updateReview(period: ReviewPeriod, patch: Partial<Pick<Review, 'highlights' | 'friction' | 'nextSteps'>> & { completedAt?: null }): Review {
    if (!validReviewPeriod(period)) throw new Error('无效的复盘日期');
    for (const field of ['highlights', 'friction', 'nextSteps'] as const) if (patch[field] !== undefined && (typeof patch[field] !== 'string' || patch[field]!.length > 100000)) throw new Error('复盘内容过长或格式无效');
    const id = reviewId(period), fields = this.docs.root.getMap('reviewFields'), timestamp = now();
    this.docs.root.transact(() => {
      const base = { kind: period.kind, periodStart: period.start, periodEnd: period.end, ownerId: this.userId, createdAt: timestamp };
      for (const [field, value] of Object.entries(base)) if (!fields.has(`${id}/${field}`)) fields.set(`${id}/${field}`, value);
      for (const field of ['highlights', 'friction', 'nextSteps'] as const) if (patch[field] !== undefined) {
        fields.set(`${id}/${field}`, patch[field]);
        fields.set(`${id}/completedAt`, null);
      }
      if (patch.completedAt === null) fields.set(`${id}/completedAt`, null);
      fields.set(`${id}/updatedAt`, timestamp);
    });
    return this.getData().reviews.find(review => review.id === id)!;
  }

  completeReview(period: ReviewPeriod): Review {
    if (!validReviewPeriod(period)) throw new Error('无效的复盘日期');
    const id = reviewId(period);
    const review = this.getData().reviews.find(item => item.id === id);
    if (!review || ![review.highlights, review.friction, review.nextSteps].some(value => value.trim())) throw new Error('写下一点收获、反思或下一步，再完成复盘');
    if (review.periodEnd !== period.end) throw new Error('复盘周期已经变化，请重新打开这份复盘');
    const timestamp = now(), facts = reviewFacts(this.getData(), period, timestamp);
    this.docs.root.transact(() => {
      const fields = this.docs.root.getMap('reviewFields');
      fields.set(`${id}/facts`, facts);
      fields.set(`${id}/completedAt`, timestamp);
      fields.set(`${id}/updatedAt`, timestamp);
    });
    return this.getData().reviews.find(item => item.id === id)!;
  }

  // ---------- 通用实体写 ----------

  private entityMap(docId: Exclude<DocId, 'root'>): Y.Map<Y.Map<unknown>> {
    return this.docs[docId].getMap('items') as Y.Map<Y.Map<unknown>>;
  }

  private put(docId: Exclude<DocId, 'root'>, entity: Record<string, unknown>): void {
    const items = this.entityMap(docId);
    let ymap = items.get(entity.id as string) as Y.Map<unknown> | undefined;
    if (!ymap) {
      ymap = new Y.Map();
      items.set(entity.id as string, ymap);
    }
    ymap.doc!.transact(() => {
      for (const [k, v] of Object.entries(entity)) {
        if (v !== undefined) ymap.set(k, v);
      }
    });
  }

  /**
   * 只写「变化的字段」——字段级合并的关键:未改字段不重写,
   * 避免并发编辑同一实体不同字段时制造幻影冲突(见 DEVLOG)。
   */
  private patchEntity(docId: Exclude<DocId, 'root'>, id: string, patch: Record<string, unknown>): void {
    const items = this.entityMap(docId);
    const ymap = items.get(id) as Y.Map<unknown> | undefined;
    if (!ymap) return;
    ymap.doc!.transact(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (v !== undefined) ymap.set(k, v);
      }
    });
  }

  private get<T>(docId: Exclude<DocId, 'root'>, id: string): T | null {
    const ymap = this.entityMap(docId).get(id) as Y.Map<unknown> | undefined;
    return ymap ? ((ymap.toJSON() as unknown) as T) : null;
  }

  // ---------- Tasks ----------

  createTask(patch: Partial<Task> & { title?: string } = {}): Task {
    const t: number = now();
    const task: Task = {
      id: newId(),
      title: patch.title?.trim() || 'Untitled',
      notes: patch.notes,
      status: patch.status ?? 'inbox',
      kind: patch.project ? 'node' : patch.kind ?? 'todo',
      project: patch.project ?? (patch.kind === 'node' && patch.parentId == null),
      parentId: patch.project ? null : patch.parentId ?? null,
      order: patch.order ?? 0,
      important: patch.important ?? false,
      urgent: patch.urgent ?? false,
      ...(patch.priority ? { priority: patch.priority, ...quadrantFields(patch.priority) } : {}),
      tags: patch.tags ?? [],
      startAt: patch.startAt ?? null,
      dueAt: patch.dueAt ?? null,
      estimateMin: patch.estimateMin,
      ownerId: this.userId,
      createdAt: t,
      updatedAt: t,
      completedAt: patch.status === 'done' ? patch.completedAt ?? t : null,
      deletedAt: null,
    };
    this.put('tasks', task as unknown as Record<string, unknown>);
    return task;
  }

  createProject(title: string): Task {
    if (!title.trim()) throw new Error('请输入项目名称');
    const roots = this.getData().tasks.filter((task) => !task.parentId && !task.deletedAt);
    const lastOrder = roots.length ? Math.max(...roots.map((task) => task.order)) : undefined;
    return this.createTask({ title, kind: 'node', project: true, status: 'todo', order: newOrder(lastOrder) });
  }

  updateTask(id: string, patch: Partial<Task>): void {
    const cur = this.get<Task>('tasks', id);
    if (!cur) return;
    if (isProject(cur) && (patch.parentId != null || patch.kind === 'todo' || patch.project === false)) return;
    // Stamp legacy structural identity before moving it, so an internal group stays a group.
    if (cur.kind === 'node' && cur.project === undefined) patch = { ...patch, project: isProject(cur) };
    if (patch.kind === 'node' && cur.kind !== 'node' && patch.project === undefined)
      patch = { ...patch, project: cur.parentId === null };
    if (cur.project === true || patch.project === true) patch = { ...patch, kind: 'node', parentId: null };
    if (patch.parentId !== undefined && patch.parentId !== cur.parentId) {
      const tasks = this.getData().tasks;
      if (patch.parentId !== null && !tasks.some((t) => t.id === patch.parentId && !t.deletedAt)) return;
      if (!canReparent(id, patch.parentId, buildChildrenMap(tasks))) return;
    }
    if (patch.priority) patch = { ...patch, ...quadrantFields(patch.priority) };
    else if (patch.important !== undefined || patch.urgent !== undefined) {
      const important = patch.important ?? cur.important, urgent = patch.urgent ?? cur.urgent;
      patch = { ...patch, priority: important ? urgent ? 'P0' : 'P1' : urgent ? 'P2' : 'P3' };
    }
    const safe = { ...patch };
    delete safe.id;
    delete safe.ownerId;
    this.patchEntity('tasks', id, { ...safe, updatedAt: now() });
  }

  /** 设显式优先级(P0~P3);同时落 important/urgent,四象限与优先级永远一致 */
  setTaskPriority(id: string, priority: Priority): void {
    this.updateTask(id, { priority, ...quadrantFields(priority) });
  }

  /** 节点类型切换:todo(可完成) ↔ node(结构性容器,无完成态/状态/优先级/时间) */
  setTaskKind(id: string, kind: 'todo' | 'node'): void {
    const cur = this.get<Task>('tasks', id);
    if (!cur || cur.kind === kind) return;
    this.updateTask(id, { kind });
  }

  setTaskStatus(id: string, status: TaskStatus): void {
    const cur = this.get<Task>('tasks', id);
    if (!cur || cur.status === status) return;
    const t = now();
    this.updateTask(id, {
      status,
      completedAt: status === 'done' ? t : null,
      // 勾选完成且原本没有截止时间 → 截止补为完成时刻(完成即"按时",甘特/时间线的条落到实际完成点);
      // 原本就有截止时间的保持不动,不覆盖用户排期
      ...(status === 'done' && cur.dueAt == null ? { dueAt: t } : {}),
    });
  }

  toggleTaskDone(id: string): void {
    const cur = this.get<Task>('tasks', id);
    if (!cur || isStructural(cur)) return; // 结构性节点没有完成态
    if (cur.status === 'done') this.setTaskStatus(id, cur.important ? 'todo' : 'todo');
    else this.setTaskStatus(id, 'done');
  }

  /** 软删整个子树 */
  softDeleteTask(id: string): void {
    const t = now();
    const visited = new Set<string>();
    const children = buildChildrenMap(this.getData().tasks);
    const walk = (taskId: string) => {
      if (visited.has(taskId)) return;
      visited.add(taskId);
      const cur = this.get<Task>('tasks', taskId);
      if (!cur) return;
      this.updateTask(taskId, { deletedAt: cur.deletedAt ?? t });
      for (const child of children.get(taskId) ?? []) {
        if (child.deletedAt) continue;
        walk(child.id);
      }
    };
    walk(id);
  }

  restoreTask(id: string): void {
    const visited = new Set<string>();
    const children = buildChildrenMap(this.getData().tasks);
    const walk = (taskId: string) => {
      if (visited.has(taskId)) return;
      visited.add(taskId);
      const cur = this.get<Task>('tasks', taskId);
      if (!cur) return;
      this.updateTask(taskId, { deletedAt: null });
      for (const child of children.get(taskId) ?? []) walk(child.id);
    };
    walk(id);
  }

  /** 物理清除已软删超期的任务(回收站策略) */
  purgeDeleted(beforeMs: number): number {
    const items = this.entityMap('tasks');
    let n = 0;
    items.doc!.transact(() => {
      for (const [id, ymap] of items.entries()) {
        const deletedAt = ymap.get('deletedAt') as number | undefined;
        if (deletedAt != null && deletedAt < beforeMs) {
          items.delete(id);
          n++;
        }
      }
    });
    return n;
  }

  reparent(id: string, parentId: string | null, order: number): void {
    this.updateTask(id, { parentId, order, updatedAt: now() });
  }

  /** 兄弟间隙耗尽时重排 */
  renumberParent(parentId: string | null): void {
    const siblings = this.getData().tasks.filter(
      (t) => t.parentId === parentId && !t.deletedAt && t.status !== 'archived',
    );
    const writes = renumberSiblings(siblings);
    for (const w of writes) this.updateTask(w.id, { order: w.order });
  }

  // ---------- Events ----------

  createEvent(patch: Partial<ScheduleEvent> & { title: string; start: number; end: number }): ScheduleEvent {
    const t = now();
    const ev: ScheduleEvent = {
      kind: 'focus',
      completed: false,
      deletedAt: null,
      ...patch,
      id: newId(),
      title: patch.title,
      start: patch.start,
      end: patch.end,
      taskId: patch.taskId ?? null,
      ownerId: this.userId,
      createdAt: t,
      updatedAt: t,
    };
    this.put('events', ev as unknown as Record<string, unknown>);
    return ev;
  }

  updateEvent(id: string, patch: Partial<ScheduleEvent>): void {
    const cur = this.get<ScheduleEvent>('events', id);
    if (!cur) return;
    this.patchEntity('events', id, { ...patch, updatedAt: now() });
  }

  softDeleteEvent(id: string): void {
    this.updateEvent(id, { deletedAt: now() });
  }

  // ---------- Links ----------

  addLink(
    taskId: string,
    type: TaskLink['type'],
    target: string,
    title?: string,
    extra?: { serverId?: string; session?: string },
  ): TaskLink {
    const link: TaskLink = {
      id: newId(),
      taskId,
      type,
      target,
      title,
      ownerId: this.userId,
      createdAt: now(),
      deletedAt: null,
      ...extra,
    };
    this.put('links', link as unknown as Record<string, unknown>);
    return link;
  }

  removeLink(id: string): void {
    const items = this.entityMap('links');
    items.doc!.transact(() => items.delete(id));
  }

  // ---------- Sessions ----------

  addFocusSession(s: Omit<FocusSession, 'id' | 'ownerId'>, id = newId()): FocusSession {
    const existing = this.get<FocusSession>('sessions', id);
    if (existing) return existing;
    const session: FocusSession = { ...s, id, ownerId: this.userId };
    this.put('sessions', session as unknown as Record<string, unknown>);
    return session;
  }

  // ---------- Habits ----------

  createHabit(patch: Partial<Habit> & { name: string }): Habit {
    const habit: Habit = {
      id: newId(),
      name: patch.name,
      icon: patch.icon ?? 'Flame',
      color: patch.color ?? '#22d3ee',
      cadence: patch.cadence ?? { type: 'daily' },
      reminderAt: patch.reminderAt,
      linkedTaskTemplateId: patch.linkedTaskTemplateId ?? null,
      targetPerDay: patch.targetPerDay ?? 1,
      ownerId: this.userId,
      createdAt: now(),
      archivedAt: null,
      deletedAt: null,
    };
    this.put('habits', habit as unknown as Record<string, unknown>);
    return habit;
  }

  updateHabit(id: string, patch: Partial<Habit>): void {
    const cur = this.get<Habit>('habits', id);
    if (!cur) return;
    this.patchEntity('habits', id, patch);
  }

  deleteHabit(id: string): void {
    this.updateHabit(id, { deletedAt: now(), archivedAt: now() });
    this.entityMap('habitLogs').doc!.transact(() => {
      for (const [lid, ymap] of this.entityMap('habitLogs').entries()) {
        if (ymap.get('habitId') === id) this.entityMap('habitLogs').delete(lid);
      }
    });
  }

  /** Append immutable operations; concurrent increments and cancellation of the same unit converge. */
  logHabit(habitId: string, dayKey: string, delta: number, target = 1): void {
    if (!Number.isInteger(delta) || Math.abs(delta) > 10000 || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return;
    const habit = this.getData().habits.find((h) => h.id === habitId && !h.deletedAt);
    if (!habit) return;
    const day = this.getData().habitLogs.filter((log) => log.habitId === habitId && log.date === dayKey);
    const cancelled = new Set(day.flatMap((log) => log.cancelledUnits ?? []));
    const units: string[] = [];
    if (delta < 0) {
      for (const log of day) for (let i = 0; i < log.count; i++) {
        const unit = `${log.id}:${i}`;
        if (!cancelled.has(unit) && units.length < -delta) units.push(unit);
      }
      if (!units.length) return;
    }
    if (!delta) return;
    const log: HabitLog = { id: newId(), habitId, date: dayKey, count: delta > 0 ? Math.min(delta, Math.max(1, target) * 3) : 0,
      ownerId: this.userId, ...(units.length ? { cancelledUnits: units } : {}) };
    this.put('habitLogs', log as unknown as Record<string, unknown>);
  }

  // ---------- Tags ----------

  ensureTag(name: string, color?: string): Tag {
    const clean = name.trim();
    const tagsMap = this.docs.root.getMap<Y.Map<unknown>>('tags');
    for (const ymap of tagsMap.values()) {
      if ((ymap.get('name') as string).toLowerCase() === clean.toLowerCase()) {
        return ymap.toJSON() as unknown as Tag;
      }
    }
    const tag: Tag = { id: newId(), name: clean, color, ownerId: this.userId, deletedAt: null };
    const ymap = new Y.Map();
    tagsMap.set(tag.id, ymap);
    ymap.doc!.transact(() => {
      ymap.set('id', tag.id);
      ymap.set('name', tag.name);
      if (color) ymap.set('color', color);
      ymap.set('ownerId', tag.ownerId);
    });
    return tag;
  }

  updateTag(id: string, patch: Partial<Tag>): void {
    const ymap = this.docs.root.getMap<Y.Map<unknown>>('tags').get(id);
    if (!ymap) return;
    ymap.doc!.transact(() => {
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) ymap.set(k, v);
    });
  }

  deleteTag(id: string): void {
    const tagsMap = this.docs.root.getMap('tags');
    tagsMap.doc!.transact(() => tagsMap.delete(id));
  }

  // ---------- Settings ----------

  updateSettings(patch: Partial<Settings>): void {
    const map = this.docs.root.getMap<unknown>('settings');
    map.doc!.transact(() => {
      for (const [k, v] of Object.entries(patch)) map.set(k, v);
    });
  }

  // ---------- 导出 / 导入 / 迁移 ----------

  exportJSON(): CortexData {
    return this.getData();
  }

  exportSnapshot(): CortexSnapshot {
    return { format: 'cortex.export', version: 2, exportedAt: now(), data: this.exportJSON(),
      docs: Object.fromEntries(DOC_IDS.map((id) => [id, toBase64(Y.encodeStateAsUpdate(this.docs[id]))])) };
  }

  /** Binary backups preserve causal history; legacy JSON only adds missing entities/setting keys. */
  importJSON(input: unknown): number {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('无效的备份文件');
    const envelope = input as Record<string, unknown>;
    if (envelope.format !== undefined && !['cortex.export', 'cortex.server-export'].includes(String(envelope.format))) throw new Error('不支持的备份格式');
    if (envelope.format && envelope.version !== 1 && envelope.version !== 2) throw new Error('不支持的备份版本');
    if (envelope.docs !== undefined) {
      if (!envelope.docs || typeof envelope.docs !== 'object' || Array.isArray(envelope.docs)) throw new Error('无效的文档快照');
      const updates: Partial<Record<DocId, Uint8Array>> = {};
      for (const [id, encoded] of Object.entries(envelope.docs)) {
        if (!(DOC_IDS as readonly string[]).includes(id) || typeof encoded !== 'string' || encoded.length > 16 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('无效的文档快照');
        if (encoded) updates[id as DocId] = fromBase64(encoded);
      }
      // A preview ensures a corrupt later document cannot leave earlier documents half imported.
      const preview = new CortexStore(this.userId);
      try {
        for (const id of DOC_IDS) {
          Y.applyUpdate(preview.docs[id], Y.encodeStateAsUpdate(this.docs[id]), 'preview');
          if (updates[id]) Y.applyUpdate(preview.docs[id], updates[id]!, 'preview');
        }
        validateCortexData(preview.getData());
      } finally { preview.destroy(); for (const doc of Object.values(preview.docs)) doc.destroy(); }
      const before = this.getData();
      const beforeCount = before.tasks.length + before.events.length + before.reviews.length;
      this.withUndoSuspended(() => {
        for (const id of DOC_IDS) if (updates[id]) Y.applyUpdate(this.docs[id], updates[id]!, 'import');
      });
      const after = this.getData();
      return Math.max(0, after.tasks.length + after.events.length + after.reviews.length - beforeCount);
    }
    const data = validateCortexData(envelope.data ?? input);
    return this.withUndoSuspended(() => this.importJSONInner(data));
  }

  private importJSONInner(data: Partial<CortexData>): number {
    let count = 0;
    const importRows = <T extends { id: string }>(id: Exclude<DocId, 'root'>, rows: T[] | undefined, defaults: () => T) => {
      for (const row of rows ?? []) {
        if (this.entityMap(id).has(row.id)) continue;
        this.put(id, { ...defaults(), ...row, ownerId: this.userId });
        count++;
      }
    };
    importRows('tasks', data.tasks, defaultsTask);
    importRows('events', data.events, defaultsEvent);
    importRows('links', data.links, defaultsLink);
    importRows('sessions', data.sessions, defaultsSession);
    importRows('habits', data.habits, defaultsHabit);
    importRows('habitLogs', data.habitLogs, defaultsLog);
    const reviewFields = this.docs.root.getMap('reviewFields');
    const reviewIds = new Set(this.getData().reviews.map(review => review.id));
    this.docs.root.transact(() => {
      for (const review of data.reviews ?? []) if (!reviewIds.has(review.id)) {
        for (const [field, value] of Object.entries({ ...review, ownerId: this.userId })) {
          if (field !== 'id') reviewFields.set(`${review.id}/${field}`, value);
        }
        count++;
      }
    });
    const tags = this.docs.root.getMap<Y.Map<unknown>>('tags');
    for (const tag of data.tags ?? []) if (!tags.has(tag.id)) {
      const entity = new Y.Map<unknown>();
      this.docs.root.transact(() => {
        tags.set(tag.id, entity);
        for (const [key, value] of Object.entries({ ...defaultsTag(), ...tag, ownerId: this.userId })) if (value !== undefined) entity.set(key, value);
      });
      count++;
    }
    const settings = this.docs.root.getMap('settings');
    for (const [key, value] of Object.entries(data.settings ?? {})) {
      if (!settings.has(key)) settings.set(key, value);
      else if (key === 'servers' && Array.isArray(value)) {
        const existing = this.getData().settings.servers;
        settings.set(key, [...existing, ...value.filter((server) => !existing.some((old) => old.id === server.id))]);
      }
    }
    return count;
  }

  /** Claim each anonymous batch once, after loading the destination's persisted history. */
  absorbLocal(local: CortexStore): number {
    const meta = local.docs.root.getMap('meta');
    const claimed = meta.get('claimedBy');
    if (claimed && claimed !== this.userId) return 0;
    let batch = meta.get('batchId') as string | undefined;
    if (!batch) { batch = newId(); meta.set('batchId', batch); }
    const target = this.docs.root.getMap('meta');
    if (target.has(`imported:${batch}`)) return 0;
    const count = this.withUndoSuspended(() => {
      const count = this.importJSONInner(local.exportJSON());
      target.set(`imported:${batch}`, true);
      return count;
    });
    meta.set('claimedBy', this.userId);
    return count;
  }

  /** Call only after flushing the destination to IndexedDB. */
  consumeLocal(userId: string): void {
    const meta = this.docs.root.getMap('meta');
    if (meta.get('claimedBy') !== userId) return;
    this.withUndoSuspended(() => {
      for (const id of DOC_IDS) this.docs[id].transact(() => {
        if (id === 'root') { this.docs.root.getMap('tags').clear(); this.docs.root.getMap('settings').clear(); this.docs.root.getMap('reviewFields').clear(); }
        else this.entityMap(id).clear();
      });
      meta.delete('claimedBy');
      meta.set('batchId', newId());
    });
  }

}

// ---------- 派生工具 ----------

type YLike = { toJSON(): unknown };

function collect<T>(docOrMap: Y.Doc | YLike, defaults: () => T): T[] {
  const items =
    docOrMap instanceof Y.Doc ? (docOrMap.getMap('items') as unknown as YLike) : docOrMap;
  const json = (items.toJSON() as Record<string, Record<string, unknown>>) ?? {};
  const out: T[] = [];
  for (const raw of Object.values(json)) {
    if (typeof raw?.id !== 'string' || !raw.id) continue;
    out.push({ ...defaults(), ...raw } as T);
  }
  return out;
}

const defaultsTask = (): Task => ({
  id: '',
  title: '',
  status: 'inbox',
  parentId: null,
  order: 0,
  important: false,
  urgent: false,
  tags: [],
  startAt: null,
  dueAt: null,
  ownerId: '',
  createdAt: 0,
  updatedAt: 0,
  completedAt: null,
  deletedAt: null,
});
const defaultsEvent = (): ScheduleEvent => ({
  id: '',
  taskId: null,
  title: '',
  start: 0,
  end: 0,
  kind: 'focus',
  completed: false,
  ownerId: '',
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
});
const defaultsLink = (): TaskLink => ({
  id: '',
  taskId: '',
  type: 'url',
  target: '',
  ownerId: '',
  createdAt: 0,
  deletedAt: null,
});
const defaultsSession = (): FocusSession => ({
  id: '',
  taskId: null,
  startedAt: 0,
  endedAt: 0,
  plannedMin: 0,
  actualMin: 0,
  mode: 'focus',
  completed: false,
  ownerId: '',
});
const defaultsHabit = (): Habit => ({
  id: '',
  name: '',
  icon: 'Flame',
  color: '#22d3ee',
  cadence: { type: 'daily' },
  ownerId: '',
  createdAt: 0,
});
const defaultsLog = (): HabitLog => ({ id: '', habitId: '', date: '', count: 1, ownerId: '' });
const defaultsTag = (): Tag => ({ id: '', name: '', ownerId: '', deletedAt: null });

export { EMPTY_DATA };
