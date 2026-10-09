import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { useQuery } from '@tanstack/react-query';
import type { Artifact, ConsoleSnapshot, Dependency, Phase, Project, Task } from '@meteor-flow/contracts';
import { Download, FileText, Plus, Search, X } from 'lucide-react';
import type { Run } from './api.js';
import { date, Empty, Field, Modal, phases, Status, Submit } from './ui.js';
import { Summary } from './Markdown.js';

const TerminalPanel = lazy(() => import('./TerminalPanel.js'));
const finalPhases: Phase[] = ['succeeded', 'failed', 'cancelled'];
type Common = { data: ConsoleSnapshot; run: Run; disabled: boolean; pending: boolean; error?: string };
export type TaskAction = { task: Task; action: string; title: string; description: string };

export function TaskForm({ data, project, task, run, disabled, pending, error, close }: Common & { project: Project; task?: Task; close: () => void }) {
  const bindings = data.bindings.filter(binding => binding.projectId === project.id);
  const [dependencies, setDependencies] = useState<Dependency[]>(task?.dependencies ?? []);
  const candidates = data.tasks.filter(candidate => candidate.projectId === project.id && candidate.id !== task?.id && (!candidate.archived || task?.dependencies.some(dep => dep.taskId === candidate.id)));
  const [validation, setValidation] = useState('');
  return <Modal title={task ? '编辑待派发任务' : '新建任务'} description={`任务属于「${project.name}」。执行开始后，输入与依赖版本冻结；关闭网页不取消任务。`} close={close}>
    <form onSubmit={async event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      const roots = String(form.get('outputRoots') ?? '').split('\n').map(line => line.trim()).filter(Boolean);
      const outputRoots = roots.map(line => { const split = line.indexOf('='); return { id: line.slice(0, split).trim(), path: line.slice(split + 1).trim() }; });
      if (roots.some(line => line.indexOf('=') < 1) || outputRoots.some(root => !/^[a-zA-Z0-9_-]+$/.test(root.id) || !root.path.startsWith('/')) || new Set(outputRoots.map(root => root.id)).size !== outputRoots.length) { setValidation('授权输出根请每行填写「唯一标识=/绝对路径」。'); return; }
      setValidation('');
      const body = { projectId: project.id, bindingId: form.get('bindingId'), title: String(form.get('title')).trim(), instructions: String(form.get('instructions')).trim(), dependencies, requiredArtifacts: String(form.get('requiredArtifacts') ?? '').split('\n').map(line => line.trim()).filter(Boolean), outputRoots, ...(task ? { expected_revision: task.revision } : {}) };
      if (await run(task ? `/api/v1/tasks/${task.id}` : '/api/v1/tasks', body, task ? 'PUT' : 'POST')) close();
    }}>
      <Field label="任务名称"><input name="title" required maxLength={160} defaultValue={task?.title} placeholder="例如：整理本周检索实验结论" /></Field>
      <Field label="指定 Agent"><select name="bindingId" required defaultValue={task?.bindingId ?? bindings[0]?.id ?? ''}><option value="" disabled>选择当前项目的 Agent</option>{bindings.map(binding => <option key={binding.id} value={binding.id}>{binding.label} · {binding.mode === 'automatic' ? '自动调度' : binding.mode === 'manual' ? '手动使用' : '观察模式'}</option>)}</select></Field>
      <Field label="任务说明"><textarea name="instructions" required rows={5} maxLength={64000} defaultValue={task?.instructions} placeholder="描述目标、约束与需要交付的结果。" /></Field>
      <fieldset><legend>前置任务与必要输入产物</legend><p className="muted">只使用同一项目的归档结果。勾选任务后，可选择必须具备的产物；未选产物仍等待任务成功。</p>
        {candidates.length ? candidates.map(candidate => { const selected = dependencies.find(dep => dep.taskId === candidate.id); return <div className="dependency-option" key={candidate.id}>
          <label className="check"><input type="checkbox" checked={!!selected} onChange={event => setDependencies(current => event.target.checked ? [...current, { taskId: candidate.id, artifacts: [] }] : current.filter(dep => dep.taskId !== candidate.id))} />{candidate.title}{candidate.archived && '（已归档）'}<Status phase={candidate.phase} /></label>
          {selected && <div className="dependency-artifacts">{data.artifacts.filter(artifact => artifact.taskId === candidate.id && (artifact.attemptId === candidate.currentAttemptId || selected.artifacts.includes(artifact.id))).map(artifact => <label className="check" key={artifact.id}><input type="checkbox" checked={selected.artifacts.includes(artifact.id)} onChange={event => setDependencies(current => current.map(dep => dep.taskId === candidate.id ? { ...dep, artifacts: event.target.checked ? [...dep.artifacts, artifact.id] : dep.artifacts.filter(id => id !== artifact.id) } : dep))} />{artifact.label}{artifact.attemptId !== candidate.currentAttemptId && '（历史执行）'}</label>)}</div>}
        </div>; }) : <p className="muted">当前没有可选的前置任务。</p>}
      </fieldset>
      <details><summary>结果要求与额外输出范围</summary><Field label="必要产物" hint="每行填写一个产物要求；无需文件交付时可留空。"><textarea name="requiredArtifacts" rows={3} defaultValue={task?.requiredArtifacts.join('\n')} placeholder="例如：report.md" /></Field><Field label="授权输出根" hint="默认允许 Agent 工作目录。额外范围每行填写 root_id=/绝对路径，最多 10 项。"><textarea name="outputRoots" rows={3} defaultValue={task?.outputRoots.map(root => `${root.id}=${root.path}`).join('\n')} placeholder="reports=/Users/you/reports" /></Field></details>
      {(validation || error) && <p className="form-error" role="alert">{validation || error}</p>}
      {!bindings.length && <p className="form-error">请先到 Agent 页面接入或启动一个 Agent。</p>}
      <div className="dialog-actions"><button type="button" onClick={close}>取消</button><Submit pending={pending} disabled={disabled || !bindings.length}>{task ? '保存修改' : '创建任务'}</Submit></div>
    </form>
  </Modal>;
}

export function TaskList({ data, project, search, phase, archived, setFilter, selectTask, create, disabled }: { data: ConsoleSnapshot; project: Project; search: string; phase: string; archived: boolean; setFilter: (key: string, value: string) => void; selectTask: (id: string) => void; create: () => void; disabled: boolean }) {
  const tasks = data.tasks.filter(task => task.projectId === project.id && task.archived === archived && (!phase || task.phase === phase) && `${task.title} ${task.instructions} ${task.reason}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <><div className="page-heading"><div><h1>任务</h1><p className="muted">{project.name} · 指定 Agent，按依赖与就绪状态推进。</p></div><button className="primary" disabled={disabled} onClick={create}><Plus size={17} />新建任务</button></div>
    <div className="filters"><label className="search"><Search size={17} /><input aria-label="搜索任务" placeholder="搜索任务、说明或等待原因" value={search} onChange={event => setFilter('q', event.target.value)} /></label><select aria-label="筛选任务状态" value={phase} onChange={event => setFilter('phase', event.target.value)}><option value="">全部状态</option>{Object.entries(phases).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><label className="check"><input type="checkbox" checked={archived} onChange={event => setFilter('archived', event.target.checked ? '1' : '')} />已归档</label></div>
    {tasks.length ? <div className="table-wrap"><table><thead><tr><th>任务 / 等待原因</th><th>任务阶段</th><th>指定 Agent</th><th>前置任务</th><th>创建时间</th></tr></thead><tbody>{tasks.map(task => <tr key={task.id}><td><button id={`task-select-${task.id}`} className="text-button task-title" onClick={() => selectTask(task.id)}>{task.title}</button><p className="reason">{task.reason || (task.phase === 'queued' ? '等待调度条件核对' : '查看详情与执行证据')}</p></td><td><Status phase={task.phase} /></td><td>{data.bindings.find(binding => binding.id === task.bindingId)?.label ?? '绑定不可用'}</td><td>{task.dependencies.length ? task.dependencies.map(dep => data.tasks.find(item => item.id === dep.taskId)?.title ?? dep.taskId).join('、') : '无依赖'}</td><td className="numeric muted">{date(task.createdAt)}</td></tr>)}</tbody></table></div> : <Empty title={search || phase || archived ? '没有匹配的任务' : '准备好第一项工作'}><p>{search || phase || archived ? '调整搜索条件或状态筛选，查看其他任务。' : '创建任务，说明目标并指定 Agent。依赖不满足的任务会等待，独立任务仍可推进。'}</p>{!search && !phase && !archived && <button className="primary" disabled={disabled} onClick={create}>创建第一个任务</button>}</Empty>}
  </>;
}

function ArtifactPreview({ artifact, artifacts, close }: { artifact: Artifact; artifacts: Artifact[]; close: () => void }) {
  const [image,setImage]=useState<string|null>(null);
  const content = useQuery({ queryKey: ['artifact', artifact.id], queryFn: async () => {
    const response = await fetch(`/api/v1/artifacts/${encodeURIComponent(artifact.id)}/content`, { credentials: 'same-origin', signal: AbortSignal.timeout(12000) });
    if (!response.ok) {const error=await response.json().catch(()=>null);throw new Error(error?.error?.message??'产物预览失败，请重新读取状态或下载文件。');}
    const type = response.headers.get('content-type')?.split(';')[0];
    if (type && /^image\/(png|jpeg|gif|webp)$/.test(type)) return {image:await response.blob(),text:''};
    if (type !== 'text/plain') throw new Error('此内容类型不支持安全预览，请下载后查看。');
    return {image:null,text:await response.text()};
  } });
  useEffect(()=>{if(!content.data?.image){setImage(null);return;}const url=URL.createObjectURL(content.data.image);setImage(url);return()=>URL.revokeObjectURL(url);},[content.data]);
  let text=content.data?.text??'';
  if(/\.json$/i.test(artifact.sourcePath)){try{text=JSON.stringify(JSON.parse(text),null,2);}catch{/* retain the archived bytes as text */}}
  return <Modal title={artifact.label} description="仅预览已归档内容。文本上限 1 MiB，图片上限 20 MiB；超限或不支持的格式可下载。" close={close}>{content.isPending ? <p>正在读取归档文件…</p> : content.isError ? <p role="alert" className="form-error">{content.error.message}</p> : content.data?.image ? image&&<img src={image} alt={artifact.label} style={{maxWidth:'100%',maxHeight:'60vh',objectFit:'contain'}} /> : /\.md$/i.test(artifact.sourcePath)?<Summary markdown={text} artifacts={artifacts} source={artifact}/>:<pre className="artifact-content">{text}</pre>}<a className="button" href={`/api/v1/artifacts/${encodeURIComponent(artifact.id)}/content?download=1`} download><Download size={16} />下载归档</a></Modal>;
}

export function TaskDetail({ data, task, csrf, disabled, fresh, close, edit, action }: { data: ConsoleSnapshot; task: Task; csrf: string; disabled: boolean; fresh: boolean; close: () => void; edit: () => void; action: (value: TaskAction) => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => { heading.current?.focus({ preventScroll: true }); heading.current?.scrollIntoView({ block: 'start' }); }, [task.id]);
  const attempts = data.attempts.filter(attempt => attempt.taskId === task.id).sort((a, b) => b.number - a.number);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Artifact | null>(null);
  const attempt = attempts.find(item => item.id === (attemptId ?? task.currentAttemptId)) ?? attempts[0];
  const binding = data.bindings.find(item => item.id === task.bindingId);
  const artifacts = data.artifacts.filter(item => item.taskId === task.id && item.attemptId === attempt?.id);
  const taskAction = (name: string, title: string, description: string) => action({ task, action: name, title, description });
  return <section className="task-detail" aria-label="任务详情"><div className="heading-row"><div><h2 ref={heading} id="task-detail-heading" tabIndex={-1}>{task.title}</h2><div className="actions"><Status phase={task.phase} /><span className="muted">任务详情 · 修订 {task.revision}</span></div></div><button className="icon-button" onClick={close} aria-label="关闭任务详情"><X size={20} /></button></div>
    {task.reason && <p className={task.phase === 'needs_confirmation' ? 'banner warning' : 'detail-reason'}>{task.reason}</p>}
    <div className="actions task-actions">
      {task.phase === 'queued' && !task.currentAttemptId && <button disabled={disabled} onClick={edit}>编辑任务</button>}
      {!finalPhases.includes(task.phase) && task.phase !== 'cancelling' && <button disabled={disabled} onClick={() => taskAction('cancel', '取消任务', '取消请求不保证执行立即停止。服务端核对停止前会继续保留占用；成功与取消按持久化接受顺序判定。')}>取消任务</button>}
      {!task.archived && ['failed','cancelled'].includes(task.phase) && <button disabled={disabled} onClick={() => taskAction('retry', '重试任务', '重试会创建新的执行尝试，沿用当前工作目录中的文件，不会回滚修改。请先核实旧执行已停止且输入框没有残留。')}>重试</button>}
      {finalPhases.includes(task.phase) && <button disabled={disabled} onClick={() => taskAction('copy', '复制为新任务', '复制任务配置并创建独立任务，原有执行与产物保持可追溯。新任务将按当前调度条件排队。')}>复制任务</button>}
      {task.phase === 'needs_confirmation' && <>{!data.attempts.some(item => item.id === task.currentAttemptId && item.resultConflict) && <button disabled={disabled} onClick={() => taskAction('retry-collection', '重新收集结果', '仅重试结果文件处理，不重新投递或执行 Agent 任务。若结果不完整或不匹配，任务仍将等待处理。')}>重新收集</button>}<button disabled={disabled} onClick={() => taskAction('record-conclusion', '人工补录结论', '可先保存人工声明、原因与证据。只有停止证据经服务端核验后才会解除占用；成功仍须具备有效归档。')}>补录结论</button></>}
      {finalPhases.includes(task.phase) && !task.archived && <button disabled={disabled} onClick={() => taskAction('archive', '归档任务', '任务将从默认列表隐藏，现有依赖、执行历史和归档产物仍可追溯。')}>归档</button>}
    </div>
    <Field label="执行尝试"><select value={attempt?.id ?? ''} onChange={event => setAttemptId(event.target.value === task.currentAttemptId ? null : event.target.value)}>{!attempts.length && <option value="">尚未开始执行</option>}{attempts.map(item => <option key={item.id} value={item.id}>第 {item.number} 次 · {phases[item.phase]} · {date(item.createdAt)}</option>)}</select></Field>
    <Tabs.Root defaultValue="overview"><Tabs.List className="tabs" aria-label="任务详情标签"><Tabs.Trigger value="overview">概览</Tabs.Trigger><Tabs.Trigger value="input">冻结输入</Tabs.Trigger><Tabs.Trigger value="terminal">终端</Tabs.Trigger><Tabs.Trigger value="result">结果与产物</Tabs.Trigger><Tabs.Trigger value="events">时间线</Tabs.Trigger></Tabs.List>
      <Tabs.Content value="overview"><dl className="facts"><dt>指定 Agent</dt><dd>{binding?.label ?? '绑定不可用'}</dd><dt>任务标识</dt><dd><code>{task.id}</code></dd><dt>执行标识</dt><dd><code>{attempt?.id ?? '尚未分配'}</code></dd><dt>执行占用</dt><dd>{attempt?.occupies ? '仍保留占用，不能盲目重试' : '无当前占用'}</dd><dt>执行阶段</dt><dd>{attempt ? <Status phase={attempt.phase} /> : '尚未开始'}</dd><dt>执行说明</dt><dd>{attempt?.reason || '无额外说明'}</dd><dt>创建 / 结束</dt><dd>{date(attempt?.createdAt)} / {date(attempt?.endedAt)}</dd></dl><h3>任务说明</h3><p className="pre-wrap">{task.instructions}</p><h3>前置任务</h3>{task.dependencies.length ? <ul>{task.dependencies.map(dep => <li key={dep.taskId}>{data.tasks.find(item => item.id === dep.taskId)?.title ?? dep.taskId} · 必要产物 {dep.artifacts.length} 项</li>)}</ul> : <p className="muted">无前置任务</p>}</Tabs.Content>
      <Tabs.Content value="input">{attempt ? <><p className="muted">以下输入属于所选执行尝试。上游后续重试不会改变这份快照。</p><h3>{attempt.input.title}</h3><p className="pre-wrap">{attempt.input.instructions}</p><h3>授权输出根</h3><ul>{attempt.input.roots.map(root => <li key={root.id}><code>{root.id}: {root.path}</code></li>)}</ul><h3>必要产物</h3><p>{attempt.input.requiredArtifacts.join('、') || '无文件产物要求'}</p><h3>依赖快照</h3>{attempt.input.dependencies.map(dep => <details key={dep.taskId}><summary>{data.tasks.find(item => item.id === dep.taskId)?.title ?? dep.taskId} · {dep.attemptId}</summary><Summary markdown={dep.summary} artifacts={data.artifacts.filter(artifact => artifact.taskId === dep.taskId && artifact.attemptId === dep.attemptId && dep.artifacts.some(frozen => frozen.id === artifact.id && frozen.sha256 === artifact.sha256))} /><ul>{dep.artifacts.map(artifact => <li key={artifact.id}><code>{artifact.id} · SHA-256 {artifact.sha256}</code></li>)}</ul></details>)}</> : <p className="muted">输入会在实际派发时冻结，当前尚无执行快照。</p>}</Tabs.Content>
      <Tabs.Content value="terminal">{binding ? <Suspense fallback={<p>正在载入终端…</p>}><TerminalPanel binding={binding} csrf={csrf} fresh={fresh && data.health.connected} /></Suspense> : <p>Agent 绑定不可用。</p>}</Tabs.Content>
      <Tabs.Content value="result">{attempt && <p className="muted">结论来源：{attempt.source === 'manual' ? '人工补录' : 'Agent 协议结果'}</p>}{attempt?.manualEvidence && <p className="pre-wrap">人工证据：{attempt.manualEvidence}</p>}{attempt?.result ? <Summary markdown={attempt.result.summary} artifacts={artifacts} /> : <p className="muted">尚无有效结果。Agent 空闲或终端显示完成，不代表任务成功。</p>}<h3>归档产物</h3>{artifacts.length ? <ul className="artifact-list">{artifacts.map(artifact => <li key={artifact.id}><div><FileText size={17} /><button className="text-button" onClick={() => setPreview(artifact)}>{artifact.label}</button><span className="muted">{new Intl.NumberFormat('zh-CN').format(artifact.size)} 字节</span></div><a href={`/api/v1/artifacts/${encodeURIComponent(artifact.id)}/content?download=1`} download aria-label={`下载 ${artifact.label}`}><Download size={17} /></a><code>SHA-256 {artifact.sha256}</code></li>)}</ul> : <p className="muted">所选执行尚无归档文件。</p>}</Tabs.Content>
      <Tabs.Content value="events"><p className="muted">记录任务操作、观测与结果。终端画面不是完整会话历史，断线期间可能存在观测缺口。</p><ol className="timeline">{data.events.filter(event => event.taskId === task.id && (!event.attemptId || event.attemptId === attempt?.id)).slice().reverse().map(event => <li key={event.seq}><time>{date(event.time)}</time><span>{event.message}</span><code>{event.type}</code></li>)}</ol></Tabs.Content>
    </Tabs.Root>{preview && <ArtifactPreview artifact={preview} artifacts={artifacts} close={() => setPreview(null)} />}
  </section>;
}

export function TaskActionDialog({ value, run, disabled, pending, error, close }: { value: TaskAction; run: Run; disabled: boolean; pending: boolean; error?: string; close: () => void }) {
  const manual = value.action === 'record-conclusion';
  return <Modal title={value.title} description={`${value.task.title}：${value.description}`} close={close}><form onSubmit={async event => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    if (await run(`/api/v1/tasks/${value.task.id}/actions`, { action: value.action, expected_revision: value.task.revision, ...(manual ? { reason: form.get('reason'), evidence: form.get('evidence'), outcome: form.get('outcome'), stopped: form.get('stopped') === 'on' } : {}) })) close();
  }}>{manual && <><Field label="人工结论"><select name="outcome"><option value="failed">失败</option><option value="cancelled">取消</option><option value="succeeded">成功</option></select></Field><Field label="补录原因"><textarea required name="reason" rows={3} maxLength={4000} /></Field><Field label="证据与核对过程"><textarea required name="evidence" rows={4} maxLength={8000} /></Field><label className="check"><input type="checkbox" name="stopped" />我已核实本次执行已停止，后续不会继续写入结果</label><p className="muted">未确认停止时只保存声明并继续保留占用，不会启动重试或解除调度暂停。</p></>}{error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" onClick={close}>返回</button><Submit pending={pending} disabled={disabled}>确认{value.title}</Submit></div></form></Modal>;
}
