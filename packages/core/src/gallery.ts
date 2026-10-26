/**
 * Gallery —— 预置任务路线图(纯数据 + 纯函数,跨 app 可复用,可单测)。
 * 每个领域一个 Gallery,tree 为两层(章节 → 条目),结构天然可扩展:
 * 未来加领域只需往 GALLERIES 追加一项。
 */
export interface GalleryNode {
  title: string;
  notes?: string;
  estimateMin?: number;
  children?: GalleryNode[];
}

export interface Gallery {
  id: string;
  domain: string; // 领域名(如「分布式系统」)
  title: string; // 路线图标题
  description: string;
  color: string; // 主题色
  tree: GalleryNode[];
}

export const GALLERIES: Gallery[] = [
  {
    id: 'distributed-systems',
    domain: '分布式系统',
    title: '分布式系统学习路线图',
    description:
      '从网络与并发基础起步,到存储、分布式一致性、消息队列、缓存、可观测,再到微服务设计与动手实战,系统性打通分布式系统的知识与工程能力。',
    color: '#22d3ee',
    tree: [
      {
        title: '基础与网络',
        children: [
          { title: '计算机网络核心', notes: 'OSI / TCP·UDP / HTTP·HTTPS', estimateMin: 120 },
          { title: '操作系统与并发基础', notes: '进程 / 线程 / 调度 / 内存', estimateMin: 90 },
          { title: 'Linux 与命令行', notes: '文件系统 / 进程管理 / 网络工具(ss·tcpdump)', estimateMin: 60 },
          { title: 'RPC 与序列化', notes: 'gRPC / Protobuf / Thrift', estimateMin: 60 },
        ],
      },
      {
        title: '并发与并行',
        children: [
          { title: 'Go 并发模型', notes: 'goroutine / channel / sync', estimateMin: 90 },
          { title: 'Rust 并发(可选)', notes: 'async / Send+Sync / 无锁结构', estimateMin: 120 },
          { title: '锁与并发控制', notes: '互斥 / 条件变量 / 读写锁 / CAS', estimateMin: 90 },
          { title: 'Actor 与 CSP', notes: '消息传值,避免共享内存', estimateMin: 45 },
        ],
      },
      {
        title: '存储',
        children: [
          { title: '关系型数据库与索引', notes: 'B+ 树 / 主从 / 索引覆盖', estimateMin: 90 },
          { title: '事务与隔离级别', notes: 'ACID / MVCC / 悲观·乐观锁', estimateMin: 90 },
          { title: 'NoSQL 概览', notes: 'KV / 列族 / 文档 / 图', estimateMin: 30 },
          { title: 'LSM-Tree 与 WAL', notes: 'SSTable / 落盘顺序写 / 合并', estimateMin: 90 },
        ],
      },
      {
        title: '分布式一致性',
        children: [
          { title: 'CAP 与 PACELC', notes: '理解分布式系统的取舍', estimateMin: 45 },
          { title: 'Raft 共识', notes: '选主 / 日志复制 / 安全', estimateMin: 150 },
          { title: 'Paxos(理解即可)', notes: '与 Raft 的关系与演进', estimateMin: 60 },
          { title: '分布式事务', notes: '2PC / TCC / Saga / 最终一致', estimateMin: 90 },
          { title: '线性一致与顺序一致', notes: '读写放大的经典话题', estimateMin: 60 },
        ],
      },
      {
        title: '消息与流',
        children: [
          { title: '消息队列模式', notes: '点对点 / 发布订阅 / 延迟·死信', estimateMin: 45 },
          { title: 'Kafka 深入', notes: '分区 / 偏移量 / 幂等·事务', estimateMin: 120 },
          { title: '消费语义', notes: 'at-most / at-least / exactly-once', estimateMin: 60 },
        ],
      },
      {
        title: '缓存与 CDN',
        children: [
          { title: '缓存一致性', notes: 'cache-aside / write-through / del', estimateMin: 60 },
          { title: '分布式缓存', notes: 'Redis 集群 / 一致性哈希', estimateMin: 90 },
          { title: '缓存穿透·击穿·雪崩', notes: '空值·布隆 / 互斥 / 过期抖动', estimateMin: 45 },
        ],
      },
      {
        title: '弹性与可观测',
        children: [
          { title: '负载均衡与服务发现', notes: 'LB 策略 / 注册中心', estimateMin: 60 },
          { title: '熔断·限流·降级', notes: '令牌桶 / 滑动窗口 / 熔断器', estimateMin: 60 },
          { title: '可观测三支柱', notes: 'Logging / Metrics / Tracing(OpenTelemetry)', estimateMin: 90 },
        ],
      },
      {
        title: '微服务与系统设计',
        children: [
          { title: '微服务拆分与演进', notes: '边界 / 聚合与编排 / 网关', estimateMin: 60 },
          { title: '容器与编排', notes: 'Docker / Kubernetes 核心', estimateMin: 120 },
          { title: '经典系统设计练习', notes: '短链 / 搜索 / 社交 feed / 消息系统', estimateMin: 180 },
        ],
      },
      {
        title: '实战与工程落地',
        children: [
          { title: '手写一个小型 KV 存储', notes: '内存表 + WAL + 持久化', estimateMin: 240 },
          { title: '用 Raft 实现一个小集群', notes: '选主 + 日志复制 + 容错', estimateMin: 360 },
          { title: '单体 → 微服务演进复盘', notes: '拆分 / 数据一致性 / 可观测', estimateMin: 180 },
        ],
      },
    ],
  },
];

export function countNodes(tree: GalleryNode[]): number {
  let n = 0;
  for (const node of tree) {
    n += 1;
    if (node.children) n += countNodes(node.children);
  }
  return n;
}

/**
 * 把 Gallery 树压平成 DFS 先序的 import 项。
 * 每项带 `key`(唯一,标识一个节点)与 `parentKey`:
 *   - 顶级节点的 parentKey = `rootKey`(由调用方传入,通常指向容器任务 id)
 *   - 内部节点的 parentKey = 其父节点自身的 key(DFS 先序保证父先于子创建)
 * `order` 按兄弟 +1000 递增,符合 renumber 惯例。
 */
export interface ImportItem {
  key: string;
  title: string;
  notes?: string;
  estimateMin?: number;
  parentKey: string;
  order: number;
}

export function buildImportTasks(tree: GalleryNode[], rootKey: string): ImportItem[] {
  const out: ImportItem[] = [];
  const walk = (nodes: GalleryNode[], parentKey: string, prefix: string, startOrder: number) => {
    nodes.forEach((node, i) => {
      const key = parentKey === rootKey ? `${rootKey}#${i}` : `${prefix}.${i}`;
      out.push({
        key,
        title: node.title,
        notes: node.notes,
        estimateMin: node.estimateMin,
        parentKey,
        order: startOrder + i * 1000,
      });
      if (node.children?.length) walk(node.children, key, key, 0);
    });
  };
  walk(tree, rootKey, rootKey, 0);
  return out;
}