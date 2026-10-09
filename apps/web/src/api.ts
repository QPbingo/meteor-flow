import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConsoleSnapshot } from '@meteor-flow/contracts';

export class ApiError extends Error {
  constructor(message: string, public code: string, public uncertain = false) { super(message); }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: 'same-origin', ...options, signal: AbortSignal.timeout(options.method ? 15000 : 5000) });
  } catch {
    throw new ApiError('连接中断，操作结果尚未确认。恢复连接后可重试同一操作，服务端会核对操作标识。', 'NETWORK', true);
  }
  let data;
  try { data = await response.json(); } catch { throw new ApiError('服务端响应无法读取，操作结果尚未确认。请恢复连接后重试同一操作。', 'RESPONSE', true); }
  if (!response.ok) throw new ApiError(data.error?.message ?? `请求失败（${response.status}）`, data.error?.code ?? 'HTTP', response.status >= 500);
  return data as T;
}

const pendingKey = 'meteor-flow.pending-operations.v1';
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
async function signatureFor(path: string, method: string, body: Record<string, unknown>) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical([path, method, body])));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
function pendingOperations(): Record<string, string> {
  const value: unknown = JSON.parse(sessionStorage.getItem(pendingKey) ?? '{}');
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([key, id]) => !/^[a-f0-9]{64}$/.test(key) || typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id))) throw new Error('未决操作记录无法读取。请先核对服务端现有记录，避免重复提交。');
  return value as Record<string, string>;
}
function remember(signature: string): string {
  try {
    const pending = pendingOperations();
    if (pending[signature]) return pending[signature];
    const id = crypto.randomUUID(); pending[signature] = id;
    sessionStorage.setItem(pendingKey, JSON.stringify(pending));
    return id;
  } catch { throw new Error('无法安全保存未决操作标识，本次请求未发送。请检查浏览器存储设置，并先核对已有操作结果。'); }
}
function forget(signature: string) {
  const pending = pendingOperations(); delete pending[signature];
  sessionStorage.setItem(pendingKey, JSON.stringify(pending));
}

let authentication: Promise<{ authenticated: boolean; csrf: string | null }> | undefined;
function authenticate() {
  if (!authentication) authentication = (async () => {
    const token = new URLSearchParams(location.hash.slice(1)).get('token');
    if (token) {
      history.replaceState(null, '', location.pathname + location.search);
      const result = await request<{ csrf: string }>('/api/v1/bootstrap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
      return { authenticated: true, csrf: result.csrf };
    }
    return request<{ authenticated: boolean; csrf: string | null }>('/api/v1/auth');
  })().catch(error => { authentication = undefined; throw error; });
  return authentication;
}

export function useConsole() {
  const client = useQueryClient();
  const auth = useQuery({ queryKey: ['auth'], queryFn: authenticate, staleTime: Infinity });
  const snapshot = useQuery({ queryKey: ['state'], queryFn: () => request<ConsoleSnapshot>('/api/v1/state'), enabled: !!auth.data?.authenticated, refetchInterval: 1000, refetchIntervalInBackground: true });
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => request<{ sessions: { name: string; socketPath: string }[] }>('/api/v1/sessions'), enabled: !!auth.data?.authenticated, refetchInterval: 10000 });
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const [eventWarning, setEventWarning] = useState<string | null>(null);
  const busy = useRef(false);
  useEffect(() => {
    if (!auth.data?.authenticated) return;
    const events = new EventSource('/api/v1/events');
    const update = (event: MessageEvent) => {
      try {
        const value = JSON.parse(String(event.data));
        if (value?.protocol !== 'meteor-flow.events/v1' || !Number.isSafeInteger(value.sequence) || value.sequence < 0 || !['snapshot', 'change'].includes(value.type) || value.type !== event.type) throw new Error('Unsupported events');
        setEventWarning(null);
        void client.invalidateQueries({ queryKey: ['state'] });
      } catch {
        events.close();
        setEventWarning('实时通知的协议版本或字段不受支持，已关闭通知连接。页面继续每秒读取快照，请检查本地服务版本。');
      }
    };
    events.addEventListener('snapshot', update);
    events.addEventListener('change', update);
    events.onopen = () => setEventWarning(null);
    events.onerror = () => setEventWarning('实时通知暂时断开，正在重连；页面继续每秒读取快照。');
    return () => events.close();
  }, [auth.data?.authenticated, client]);
  const stale = snapshot.isError || !snapshot.data;
  async function run(path: string, body: Record<string, unknown>, method = 'POST') {
    if (busy.current || stale) return false;
    busy.current = true;
    setPending(true);
    let signature: string | undefined;
    try {
      signature = await signatureFor(path, method, body);
      // Save before sending. Only the hash and operation ID survive reload, not form contents.
      const operation_id = remember(signature);
      const result = await request<{ message?: string; persisted?: boolean }>(path, { method, headers: { 'content-type': 'application/json', 'x-csrf-token': auth.data?.csrf ?? '' }, body: JSON.stringify({ ...body, operation_id }) });
      forget(signature);
      await client.invalidateQueries({ queryKey: ['state'] });
      setNotice({ error: result?.persisted === false, text: result?.message ?? '服务端已接受操作，以下为最新可用状态。' });
      return true;
    } catch (error) {
      if (signature && error instanceof ApiError && !error.uncertain) {
        try { forget(signature); } catch { /* Keeping an already rejected operation is safe. */ }
      }
      setNotice({ error: true, text: error instanceof Error ? error.message : '操作失败，请重新读取状态后重试。' });
      return false;
    } finally { busy.current = false; setPending(false); }
  }
  return { auth, snapshot, sessions, run, pending, notice, eventWarning, setNotice, stale, csrf: auth.data?.csrf ?? '' };
}

export type Run = ReturnType<typeof useConsole>['run'];
