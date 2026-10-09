import { cloneElement, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, CheckCircle2, AlertCircle, Circle, LoaderCircle } from 'lucide-react';
import type { Phase } from '@meteor-flow/contracts';

export const phases: Record<Phase, string> = { queued: '待派发', dispatching: '投递中', running: '执行中', collecting: '收集结果', cancelling: '取消中', needs_confirmation: '待确认', succeeded: '已成功', failed: '已失败', cancelled: '已取消' };
export const date = (time: number | null | undefined) => time ? new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(time) : '尚未确认';
export function Status({ phase }: { phase: Phase }) {
  const Icon = phase === 'succeeded' ? CheckCircle2 : ['failed', 'needs_confirmation'].includes(phase) ? AlertCircle : ['running', 'collecting', 'dispatching', 'cancelling'].includes(phase) ? LoaderCircle : Circle;
  return <span className={`status status-${phase}`}><Icon size={14} aria-hidden="true" />{phases[phase]}</span>;
}
export function Modal({ title, description, children, close }: { title: string; description: string; children: ReactNode; close: () => void }) {
  const content = useRef<HTMLDivElement>(null);
  const [trigger] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const [triggerGroup] = useState(() => trigger?.parentElement);
  return <Dialog.Root open onOpenChange={open => { if (!open) close(); }}><Dialog.Portal><Dialog.Overlay className="overlay" /><Dialog.Content ref={content} className="dialog" onCloseAutoFocus={event => { event.preventDefault(); const nearby = triggerGroup?.isConnected ? triggerGroup.querySelector<HTMLElement>('button:not(:disabled), [tabindex="0"]') : null; const target = trigger?.isConnected && !trigger.matches(':disabled') ? trigger : nearby ?? document.querySelector<HTMLElement>('#task-detail-heading, #main'); target?.focus(); }} onOpenAutoFocus={event => { const field = content.current?.querySelector<HTMLInputElement>('input:not([disabled]),select:not([disabled]),textarea:not([disabled])'); if (field) { event.preventDefault(); field.focus(); } }}><div className="heading-row"><Dialog.Title>{title}</Dialog.Title><Dialog.Close asChild><button className="icon-button" aria-label="关闭对话框"><X size={19} /></button></Dialog.Close></div><Dialog.Description className="muted">{description}</Dialog.Description>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}
export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty"><h2>{title}</h2>{children}</div>;
}
export function Field({ label, children, hint }: { label: string; children: ReactElement<{ 'aria-labelledby'?: string; 'aria-describedby'?: string }>; hint?: string }) {
  const id = useId();
  return <label className="field"><span id={`${id}-label`}>{label}</span>{cloneElement(children, { 'aria-labelledby': `${id}-label`, 'aria-describedby': hint ? `${id}-hint` : undefined })}{hint && <small id={`${id}-hint`}>{hint}</small>}</label>;
}
export function Submit({ pending, disabled, children = '保存' }: { pending: boolean; disabled?: boolean; children?: ReactNode }) {
  return <button type="submit" className="primary" disabled={pending || disabled}>{pending ? '正在提交…' : children}</button>;
}
