import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { Binding } from '@meteor-flow/contracts';
import { LockKeyhole, Unplug } from 'lucide-react';
import { date, Modal } from './ui.js';
import '@xterm/xterm/css/xterm.css';

type Lease = { token: string; epoch: number };
type TerminalMessage =
  | { protocol: 'meteor-flow.terminal/v1'; type: 'output'; data: string }
  | { protocol: 'meteor-flow.terminal/v1'; type: 'state'; mode: 'observe' | 'control'; token?: string; epoch: number; message: string }
  | { protocol: 'meteor-flow.terminal/v1'; type: 'error'; message: string };
function parseMessage(raw: unknown): TerminalMessage {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid message');
  const message = raw as Record<string, unknown>;
  if (message.protocol !== 'meteor-flow.terminal/v1') throw new Error('Unsupported protocol');
  if (message.type === 'output' && typeof message.data === 'string') return message as TerminalMessage;
  if (message.type === 'error' && typeof message.message === 'string') return message as TerminalMessage;
  if (message.type === 'state' && typeof message.message === 'string' && Number.isSafeInteger(message.epoch) && Number(message.epoch) >= 0) {
    if (message.mode === 'observe') return message as TerminalMessage;
    if (message.mode === 'control' && Number(message.epoch) >= 1 && typeof message.token === 'string' && message.token.length > 0 && message.token.length <= 128) return message as TerminalMessage;
  }
  throw new Error('Invalid message');
}
export default function TerminalPanel({ binding, csrf, fresh }: { binding: Binding; csrf: string; fresh: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const socket = useRef<WebSocket | null>(null);
  const lease = useRef<Lease | null>(null);
  const currentFresh = useRef(fresh);
  currentFresh.current = fresh;
  const [mode, setMode] = useState<'observe' | 'control'>('observe');
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState('正在连接，只读观察。');
  const [lastFrame, setLastFrame] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [connection, setConnection] = useState(0);
  const send = (action: string, payload: Record<string, unknown> = {}) => {
    if (socket.current?.readyState !== WebSocket.OPEN || !currentFresh.current) return;
    socket.current.send(JSON.stringify({ protocol: 'meteor-flow.terminal/v1', action, ...payload }));
  };
  useEffect(() => {
    if (!fresh) {
      // Stop input immediately; close lets the server revoke the lease even if HTTP is down.
      lease.current = null; setMode('observe'); setConnected(false); socket.current?.close();
      setMessage('连接状态过期，已停止输入。重新读取状态后连接；调度仍保持暂停。');
    }
  }, [fresh]);
  useEffect(() => {
    if (!host.current) return;
    setMode('observe'); setConnected(false); setLastFrame(null);
    if (!currentFresh.current) { setMessage('连接状态过期。重新读取状态后，再连接终端。'); return; }
    let alive = true;
    const term = new Terminal({ cursorBlink: false, disableStdin: true, convertEol: false, scrollback: 5000, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, theme: { background: '#18212d', foreground: '#e5eaf2', cursor: '#bcd4ff', selectionBackground: '#405575' } });
    // Pinned xterm 6.0 emits protocol replies through onData too. Consume its
    // query sequences so remote output can never become terminal input.
    for (const id of [{ final: 'c' }, { prefix: '>', final: 'c' }, { final: 'n' }, { prefix: '?', final: 'n' }, { final: 't' }, { intermediates: '$', final: 'p' }, { prefix: '?', intermediates: '$', final: 'p' }]) term.parser.registerCsiHandler(id, () => true);
    for (const id of [4, 8, 10, 11, 12, 52]) term.parser.registerOscHandler(id, () => true);
    term.parser.registerDcsHandler({ intermediates: '$', final: 'q' }, () => true);
    term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, params => params.includes(1004));
    const fit = new FitAddon(); term.loadAddon(fit); term.open(host.current); fit.fit();
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/v1/terminal/${encodeURIComponent(binding.id)}?csrf=${encodeURIComponent(csrf)}`);
    socket.current = ws;
    let pendingOutput = 0;
    let stopReason: string | null = null;
    let lastEpoch = -1;
    const clearControl = () => { lease.current = null; term.options.disableStdin = true; term.options.cursorBlink = false; if (alive) setMode('observe'); };
    ws.onopen = () => { if (alive) { setConnected(true); setMessage('只读观察。接管后才能输入，且该 agent 的调度会暂停。'); } };
    ws.onmessage = event => {
      if (!alive || ws.readyState !== WebSocket.OPEN) return;
      try {
        const data = parseMessage(JSON.parse(String(event.data)));
        if (data.type === 'output' && typeof data.data === 'string') {
          const length = new TextEncoder().encode(data.data).byteLength;
          if (pendingOutput + length > 1024 * 1024) { stopReason = '终端输出超过页面缓冲上限，已停止连接。请核对状态后重新连接。'; clearControl(); ws.close(); setMessage(stopReason); return; }
          pendingOutput += length;
          term.write(data.data, () => { pendingOutput -= length; });
          setLastFrame(Date.now());
        }
        if (data.type === 'state') {
          if (data.epoch < lastEpoch) throw new Error('Expired terminal epoch');
          lastEpoch = data.epoch;
          clearControl();
          if (data.mode === 'control' && typeof data.token === 'string' && Number.isInteger(data.epoch) && currentFresh.current) {
            lease.current = { token: data.token, epoch: data.epoch }; term.options.disableStdin = false; term.options.cursorBlink = true; setMode('control');
            send('resize', { ...lease.current, cols: Math.min(400, Math.max(10, term.cols)), rows: Math.min(200, Math.max(2, term.rows)) });
          }
          setMessage(String(data.message ?? '控制状态已更新。'));
        }
        if (data.type === 'error') setMessage(String(data.message));
      } catch { stopReason = '终端消息版本或字段不受支持，已停止输入并断开连接。请检查服务版本后重新连接。'; clearControl(); ws.close(); setMessage(stopReason); }
    };
    ws.onclose = () => { clearControl(); if (alive) { setConnected(false); setMessage(stopReason ?? '终端连接已断开，画面已过期。不会补发按键；重新连接默认只读，调度仍暂停。'); } };
    ws.onerror = () => { clearControl(); if (alive) setMessage('终端连接失败，请检查本地服务与 herdr 后重新连接。'); };
    const input = term.onData(text => { if (lease.current && currentFresh.current) send('input', { ...lease.current, text }); });
    const resize = new ResizeObserver(() => {
      fit.fit();
      if (lease.current && currentFresh.current) send('resize', { ...lease.current, cols: Math.min(400, Math.max(10, term.cols)), rows: Math.min(200, Math.max(2, term.rows)) });
    });
    resize.observe(host.current);
    const heartbeat = window.setInterval(() => { if (lease.current && currentFresh.current) send('heartbeat', lease.current); }, 5000);
    return () => {
      alive = false;
      if (lease.current && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ protocol: 'meteor-flow.terminal/v1', action: 'release', ...lease.current }));
      lease.current = null; ws.close(); socket.current = null; resize.disconnect(); clearInterval(heartbeat); input.dispose(); term.dispose();
    };
  }, [binding.id, binding.fingerprint, csrf, connection]);
  return <section className="terminal-panel" aria-label={`${binding.label} 终端`}>
    <div className="heading-row"><h3>{binding.label} · {mode === 'control' ? '输入控制中' : '只读观察'}</h3><div className="actions">
      {!connected && <button disabled={!fresh} onClick={() => { setMode('observe'); setConnected(false); setConnection(value => value + 1); }}>重新连接</button>}
      {mode === 'control' ? <button onClick={() => { send('release', lease.current ?? {}); lease.current = null; setMode('observe'); setMessage('已停止本页输入，正在释放控制。调度保持暂停。'); }}><Unplug size={16} />释放控制</button> : <button disabled={!connected || !fresh} onClick={() => setConfirm(true)}><LockKeyhole size={16} />接管输入</button>}
    </div></div>
    <p className="terminal-notice" role="status">{message} 最后画面：{date(lastFrame)}</p>
    <div className="terminal-host" ref={host} />
    <p className="muted">原生终端仍可输入。释放控制不会恢复自动调度；请到 Agent 页面核对事实后显式恢复。</p>
    {confirm && <Modal title="接管终端输入" description="接管会暂停此 agent 后续派发。请确认画面仍有效，避免在原生终端同时输入；断线时不会保存或重放按键。" close={() => setConfirm(false)}><div className="dialog-actions"><button onClick={() => setConfirm(false)}>返回观察</button><button className="primary" disabled={!connected || !fresh} onClick={() => { send('take'); setConfirm(false); }}>确认接管</button></div></Modal>}
  </section>;
}
