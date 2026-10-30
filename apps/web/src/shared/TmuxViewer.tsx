import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { CanvasAddon } from '@xterm/addon-canvas';
import '@xterm/xterm/css/xterm.css';
import { AlertTriangle, ExternalLink, Maximize2, Minimize2, Plus, RefreshCw, SquareX, Terminal, X } from 'lucide-react';
import { cn } from '@cortex/ui';
import { api, apiUserId, socketUrl, useCortexData } from '@cortex/crdt';
import type { ServerConfig } from '@cortex/core';
import { useUI } from '@/state/ui';

/** tmux 会话直连终端(ttyd 式):xterm.js ←WS→ 服务端 ssh -tt → 远端 tmux attach。
 * 点任务上的 tmux 关联即在网页里打开该会话,可直接输入操作;关闭窗口 = detach,
 * 远端会话不受影响。窗口尺寸变化时自动断开重连(tmux 会话常驻,重新 attach 无损)。
 *
 * 复制/粘贴:xterm 选区画在 canvas 上不是 DOM 选区,必须自己接系统剪贴板 ——
 * Ctrl+Shift+C(⌘C)/ 右键复制,OSC 52(tmux copy-mode、vim)主动写入也接;
 * tmux 里开了鼠标模式时按住 Shift 拖拽可强制本地选区(xterm 内置)。
 *
 * 渲染用 canvas addon:DOM 渲染器画制表符(tmux 分屏的 │─ 边框)靠字体字形,
 * 行高对不齐会成虚线;canvas 渲染器自己绘制制表符,无缝且对齐。
 */

interface TmuxWindow {
  id: string;
  index: number;
  name: string;
  active: boolean;
}

/** 终端主体 + 工具条:弹窗(TmuxViewer)与独立标签页(TmuxPage)共用 */
function TmuxSession({
  server,
  session,
  onClose,
  standalone,
  onToggleMaximize,
  maximized,
}: {
  server: ServerConfig;
  session: string;
  onClose: () => void;
  /** 独立页模式:已全屏,不显示 最大化/新标签页 按钮,关闭 = window.close */
  standalone?: boolean;
  onToggleMaximize?: () => void;
  maximized?: boolean;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed' | 'error'>('connecting');
  const [reason, setReason] = useState<string | null>(null);
  // 尺寸变化/手动重连都会 bump 它 → effect 重建终端与连接
  const [reconnectTick, setReconnectTick] = useState(0);
  // statusRef 让 ResizeObserver 回调读到最新连接态而不重挂 effect
  const statusRef = useRef(status);
  statusRef.current = status;
  // 本次连接建立的行列:ResizeObserver 挂载即会触发一次回调,若不比对
  // 实际尺寸变化就会陷入"重连→重挂→再触发"的无限重连循环
  const connectedDims = useRef<{ cols: number; rows: number } | null>(null);
  // 复制/粘贴的回执,短暂显示在底部提示行
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);
  const flashHint = (msg: string) => {
    setFlash(msg);
    if (flashTimer.current != null) clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1600);
  };
  useEffect(() => () => { if (flashTimer.current != null) clearTimeout(flashTimer.current); }, []);

  // ---------- 窗口管理(新建/关闭;关闭需两步确认,窗口里跑的进程会被强杀) ----------
  const [windows, setWindows] = useState<TmuxWindow[] | null>(null);
  const [winBusy, setWinBusy] = useState('');
  const [confirmKill, setConfirmKill] = useState(false);
  const activeWindow = windows?.find((w) => w.active) ?? null;

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    let disposed = false;
    setStatus('connecting');
    setReason(null);

    const term = new XTerm({
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'SF Mono', Menlo, monospace",
      cursorBlink: true,
      convertEol: false,
      // 右键 = 选中光标处单词(contextmenu 处理器随后复制它;无选区时右键不弹原生菜单)
      rightClickSelectsWord: true,
      theme: {
        background: '#0b0b12',
        foreground: '#d4d4d8',
        cursor: '#22d3ee',
        selectionBackground: '#ffffff33',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(box);
    // canvas 渲染:制表符自绘,tmux 分屏边框才是连续对齐的竖/横线(DOM 渲染靠字形会错位)
    try {
      term.loadAddon(new CanvasAddon());
    } catch {
      /* canvas 不可用(极老浏览器)时回落 DOM 渲染,功能不受影响 */
    }
    fit.fit();
    termRef.current = term;
    term.write('\x1b[90m正在连接…\x1b[0m\r\n');

    let ws: WebSocket | null = null;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const connect = async () => {
      // 票据优先;服务器还没注册账号(本地开放模式)时允许不带票据直连
      let ticket = '';
      try {
        ticket = await api.ticket(apiUserId() ?? '', 'tmux');
      } catch (error) {
        if (!disposed) { setStatus('error'); setReason((error as Error).message); }
        return;
      }
      if (disposed) return;
      const url =
        socketUrl('/api/tmux/attach') +
        `${ticket ? `?ticket=${encodeURIComponent(ticket)}` : '?'}` +
        `&serverId=${encodeURIComponent(server.id)}` +
        `&session=${encodeURIComponent(session)}&cols=${term.cols}&rows=${term.rows}`;
      const sock = new WebSocket(url);
      sock.binaryType = 'arraybuffer';
      ws = sock;
      wsRef.current = sock;
      sock.onopen = () => {
        if (disposed) return;
        setStatus('open');
        connectedDims.current = { cols: term.cols, rows: term.rows };
        term.reset();
        term.focus();
        // 首帧控制消息:携带密码(服务器档案里配了才发)再开始 ssh
        sock.send(JSON.stringify({ type: 'start' }));
      };
      sock.onmessage = (ev) => {
        if (disposed) return;
        if (typeof ev.data === 'string') {
          // 控制帧:服务端 ssh 进程退出 {type:'exit', code, reason}
          try {
            const msg = JSON.parse(ev.data) as { type: string; reason?: string };
            if (msg.type === 'exit') {
              setStatus('closed');
              setReason(msg.reason ?? '会话已结束(可能不存在或已 detach)');
            }
          } catch {
            term.write(ev.data);
          }
        } else {
          term.write(new Uint8Array(ev.data));
        }
      };
      sock.onclose = () => {
        if (disposed) return;
        setStatus((s) => (s === 'closed' ? s : 'closed'));
      };
      sock.onerror = () => {
        if (!disposed) setStatus('error');
      };
    };
    void connect();

    const onData = term.onData((d) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(d);
    });

    // ---------- 复制/粘贴 ----------
    // xterm 的选区画在 canvas 上,不是 DOM 选区:Ctrl+C 只会往 pty 发 ^C、原生
    // 右键菜单的「复制」永远灰着,必须自己接系统剪贴板。三条路:
    //   键盘 Ctrl+Shift+C / ⌘C / Ctrl+Insert 复制,Ctrl+Shift+V / ⌘V / Shift+Insert 粘贴
    //     (捕获阶段拦,赶在 xterm 内部处理前 —— 组合键不该被发到 pty);
    //   右键 = 复制(rightClickSelectsWord:无选区时右键先选中单词再复制);
    //   OSC 52 = tmux copy-mode / vim 等发 \x1b]52;c;<base64>\x07 主动写剪贴板
    const writeClipboard = async (text: string) => {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          return true;
        }
      } catch {
        /* 权限被拒等,落到 execCommand 兜底 */
      }
      // http 非安全上下文(LAN IP 直连)没有 navigator.clipboard,退回 execCommand
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    };
    const copySelection = () => {
      if (!term.hasSelection()) return;
      const text = term.getSelection();
      void writeClipboard(text).then((ok) => flashHint(ok ? `已复制 ${text.length} 字符` : '复制失败(浏览器未授权剪贴板)'));
    };
    const pasteClipboard = () => {
      if (!navigator.clipboard?.readText) {
        flashHint('此环境不能读剪贴板(需 https 或 localhost 访问)');
        return;
      }
      void navigator.clipboard
        .readText()
        .then((text) => {
          if (text) term.paste(text);
          flashHint(text ? `已粘贴 ${text.length} 字符` : '剪贴板是空的');
        })
        .catch(() => flashHint('粘贴失败(浏览器未授权读取剪贴板)'));
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      const k = ev.key.toLowerCase();
      const copyCombo =
        (ev.metaKey && !ev.ctrlKey && k === 'c') ||
        (ev.ctrlKey && ev.shiftKey && !ev.metaKey && k === 'c') ||
        (ev.ctrlKey && !ev.shiftKey && !ev.metaKey && k === 'insert');
      const pasteCombo =
        (ev.metaKey && !ev.ctrlKey && k === 'v') ||
        (ev.ctrlKey && ev.shiftKey && !ev.metaKey && k === 'v') ||
        (ev.shiftKey && !ev.ctrlKey && !ev.metaKey && k === 'insert');
      if (!copyCombo && !pasteCombo) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (copyCombo) copySelection();
      else pasteClipboard();
    };
    const onContextMenu = (ev: MouseEvent) => {
      // 原生菜单对 canvas 选区没用(复制是灰的),右键一律自己接管
      ev.preventDefault();
      copySelection();
    };
    const osc52 = term.parser.registerOscHandler(52, (data) => {
      // data 形如 "c;<base64>";c=系统剪贴板;空载荷 / ? / ! 是查询或清空请求,忽略
      const semi = data.indexOf(';');
      if (semi < 0) return false;
      const payload = data.slice(semi + 1);
      if (!payload || payload === '?' || payload === '!') return true;
      try {
        const bin = atob(payload);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const text = new TextDecoder().decode(bytes);
        void writeClipboard(text).then((ok) => {
          if (ok) flashHint(`终端已写入剪贴板 ${text.length} 字符`);
        });
      } catch {
        /* 非法 base64 载荷,忽略 */
      }
      return true;
    });
    box.addEventListener('keydown', onKeyDown, true);
    box.addEventListener('contextmenu', onContextMenu);

    // 尺寸变化:防抖后比对行列,真的变了才重连(attach 时带新 cols/rows;tmux 会话常驻,无损)
    const ro = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (disposed || !boxRef.current) return;
        fit.fit();
        const d = connectedDims.current;
        if (statusRef.current === 'open' && d && (term.cols !== d.cols || term.rows !== d.rows)) {
          setReconnectTick((t) => t + 1);
        }
      }, 500);
    });
    ro.observe(box);

    return () => {
      disposed = true;
      if (resizeTimer) clearTimeout(resizeTimer);
      ro.disconnect();
      onData.dispose();
      box.removeEventListener('keydown', onKeyDown, true);
      box.removeEventListener('contextmenu', onContextMenu);
      osc52.dispose();
      ws?.close();
      wsRef.current = null;
      term.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id, session, reconnectTick]);

  /** 拉取会话的窗口列表(确认关闭时展示当前窗口名;也顺带刷新状态) */
  const refreshWindows = async () => {
    try {
      const body = await api.tmux<{ windows: TmuxWindow[] }>('windows', server.id, session);
      setWindows(body.windows ?? []);
    } catch {
      setWindows(null);
    }
  };
  useEffect(() => {
    if (status === 'open') void refreshWindows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session]);

  const newWindow = async () => {
    setWinBusy('new');
    try {
      await api.tmux('new-window', server.id, session);
      await new Promise((r) => setTimeout(r, 400));
      await refreshWindows();
    } catch (error) {
      flashHint((error as Error).message);
    } finally {
      setWinBusy('');
    }
  };

  const killActiveWindow = async () => {
    if (!activeWindow) return;
    setWinBusy('kill');
    try {
      await api.tmux('kill-window', server.id, session, { windowId: activeWindow.id });
      setConfirmKill(false);
      await new Promise((r) => setTimeout(r, 400));
      await refreshWindows();
    } catch (error) {
      flashHint((error as Error).message);
    } finally {
      setWinBusy('');
    }
  };

  const statusView = (
    <>
      <span
        className={cn(
          'h-2 w-2 rounded-full',
          status === 'open' && 'bg-[var(--success)]',
          status === 'connecting' && 'bg-[var(--warning)] animate-breathe',
          (status === 'closed' || status === 'error') && 'bg-muted/50',
        )}
      />
      <span className="text-xs text-muted">
        {status === 'open' ? '已连接' : status === 'connecting' ? '连接中…' : '已断开'}
      </span>
      {status === 'open' && windows && windows.length > 0 && (
        <span className="text-[10px] text-muted/60" title={windows.map((w) => `${w.index}:${w.name}${w.active ? '(当前)' : ''}`).join(' · ')}>
          {windows.length} 窗口
        </span>
      )}
    </>
  );

  return (
    <>
      {/* 头部 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-4 py-2.5">
        <Terminal className="h-4 w-4 shrink-0 text-[var(--accent-from)]" />
        <span className="truncate text-sm font-medium">
          {session}
          <span className="text-muted">@{server.name}</span>
        </span>
        <span className="hidden truncate text-[10px] text-muted/50 md:inline">{server.host}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {statusView}
          <span className="mx-1 h-4 w-px bg-[var(--border)]" />
          <button
            onClick={() => void newWindow()}
            disabled={winBusy === 'new' || status !== 'open'}
            className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-muted transition-colors hover:text-foreground disabled:opacity-40"
            title="新建 tmux 窗口(当前会话内,新窗口立即成为当前窗口)"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden text-[11px] md:inline">新窗口</span>
          </button>
          <button
            onClick={() => {
              setConfirmKill((v) => !v);
              if (!confirmKill) void refreshWindows();
            }}
            disabled={status !== 'open'}
            className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-muted transition-colors hover:text-[var(--danger)] disabled:opacity-40"
            title="关闭当前 tmux 窗口(窗口内进程会被终止)"
          >
            <SquareX className="h-3.5 w-3.5" />
            <span className="hidden text-[11px] md:inline">关窗口</span>
          </button>
          {!standalone && (
            <>
              <button
                onClick={onToggleMaximize}
                className="rounded-lg p-1.5 text-muted transition-colors hover:text-foreground"
                title={maximized ? '还原窗口' : '最大化'}
              >
                {maximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </button>
              <button
                onClick={() => {
                  window.open(`/tmux?server=${encodeURIComponent(server.id)}&session=${encodeURIComponent(session)}`, '_blank');
                  onClose();
                }}
                className="rounded-lg p-1.5 text-muted transition-colors hover:text-foreground"
                title="在新标签页打开(当前弹窗关闭,独立页里继续)"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          <button
            onClick={() => setReconnectTick((t) => t + 1)}
            className="rounded-lg p-1.5 text-muted transition-colors hover:text-foreground"
            title="重新连接"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted transition-colors hover:text-foreground" title={standalone ? '关闭标签页' : '关闭(detach,不影响远端会话)'}>
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 终端主体 */}
      <div ref={boxRef} className="min-h-0 flex-1 bg-[#0b0b12] px-2 py-1.5" />

      {/* 关闭窗口的两步确认(强杀进程,不可恢复,必须显式点确认) */}
      {confirmKill && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-[var(--danger)]/40 bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-4 py-2 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[var(--danger)]" />
          <span className="min-w-0 flex-1 text-[var(--danger)]">
            {activeWindow
              ? `关闭当前窗口 ${activeWindow.index}:${activeWindow.name}?`
              : '关闭当前窗口?'}
            窗口内运行的进程会被立即终止,不可恢复。
            {windows?.length === 1 ? '这是会话的最后一个窗口,关闭后整个会话也随之结束。' : ''}
          </span>
          <button onClick={() => setConfirmKill(false)} className="rounded-lg px-2.5 py-1 text-muted transition-colors hover:text-foreground">
            取消
          </button>
          <button
            onClick={() => void killActiveWindow()}
            disabled={winBusy === 'kill' || !activeWindow}
            className="rounded-lg bg-[var(--danger)] px-2.5 py-1 font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-40"
          >
            {winBusy === 'kill' ? '关闭中…' : '确认关闭'}
          </button>
        </div>
      )}

      {/* 断开原因 / 提示 */}
      {!confirmKill && (
        <div className="flex shrink-0 items-center gap-2 border-t border-[var(--border)] px-4 py-1.5 text-[11px] text-muted">
          {flash ? (
            <span className="min-w-0 flex-1 truncate text-[var(--accent-from)]">{flash}</span>
          ) : reason ? (
            <span className="min-w-0 flex-1 truncate text-[var(--danger)]" title={reason}>
              {reason}
              {/permission denied|denied/i.test(reason) ? '(免密钥未配置或密码不对:设置 → 服务器里可为该机器填密码)' : ''}
            </span>
          ) : (
            <span className="truncate" title="tmux 里开了鼠标模式时,按住 Shift 拖拽可强制浏览器本地选区">
              选中后 Ctrl+Shift+C 或右键复制(鼠标模式下按住 Shift 拖选)· Ctrl+Shift+V 粘贴 · 关闭 = detach,远端会话不受影响
            </span>
          )}
        </div>
      )}
    </>
  );
}

/** tmux 直连弹窗(全局唯一,ui.openTmuxView 控制);支持最大化 */
export function TmuxViewer() {
  const view = useUI((s) => s.tmuxView);
  const close = useUI((s) => s.closeTmuxView);
  const data = useCortexData();
  const server = view ? data.settings.servers.find((s) => s.id === view.serverId) : undefined;
  const [maximized, setMaximized] = useState(false);

  if (!view) return null;
  if (!server) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8">
        <div className="absolute inset-0 bg-black/70" />
        <div className="relative flex w-full max-w-md flex-col items-center gap-3 rounded-2xl glass-raised p-6">
          <span className="text-sm text-[var(--danger)]">服务器档案不存在(可能在设置里被删除)</span>
          <button onClick={close} className="rounded-lg px-3 py-1.5 text-xs text-muted hover:text-foreground">
            关闭
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8">
      <div className="absolute inset-0 bg-black/70" onClick={close} />
      <div
        className={cn(
          'relative flex w-full flex-col overflow-hidden glass-raised animate-fade-up',
          maximized ? 'absolute inset-0 h-full w-full max-w-none rounded-none p-0' : 'h-[85vh] max-w-5xl rounded-2xl',
        )}
      >
        <TmuxSession
          key={`${view.serverId}/${view.session}`}
          server={server}
          session={view.session}
          onClose={close}
          maximized={maximized}
          onToggleMaximize={() => setMaximized((v) => !v)}
        />
      </div>
    </div>
  );
}

/** tmux 独立标签页:/tmux?server=<档案id>&session=<会话名>(弹窗里「新标签页打开」跳这里) */
export function TmuxPage() {
  const [params] = useSearchParams();
  const data = useCortexData();
  const serverId = params.get('server');
  const session = params.get('session') ?? '';
  const server = serverId ? data.settings.servers.find((s) => s.id === serverId) : undefined;

  if (!server || !session) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[#0b0b12] p-6 text-sm text-muted">
        缺少 server / session 参数 —— 请从任务的 tmux 关联或终端弹窗进入。
      </div>
    );
  }
  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-[#0b0b12]">
      <TmuxSession
        key={`${server.id}/${session}`}
        server={server}
        session={session}
        standalone
        onClose={() => window.close()}
      />
    </div>
  );
}
