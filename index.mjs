import { createHash } from 'node:crypto';
import { isAbsolute, normalize } from 'node:path';

const shortID = id => createHash('sha256').update(id).digest('hex').slice(0, 12);
const fail = message => { throw new Error(message); };
const collection = (result, key) => Array.isArray(result) ? result : result?.[key] ?? [];
const canonical = path => normalize(path).replace(/\/$/, '');
function client(ctx) {
  const executable = ctx.configuration.cli_path || 'orca';
  return async (args, seconds = 20) => {
    const output = await ctx.exec(executable, [...args, '--json'], { timeoutSeconds: seconds });
    let envelope;
    try { envelope = JSON.parse(output.stdout); } catch { fail(`Orca returned invalid JSON: ${output.stderr || output.stdout}`); }
    if (output.exitCode !== 0 || envelope.ok === false) fail(JSON.stringify(envelope.error ?? envelope) + (output.stderr ? `\n${output.stderr}` : ''));
    return envelope.result ?? envelope;
  };
}
function state(ctx) { ctx.state ??= {}; ctx.state.handoffs ??= {}; ctx.state.messages ??= {}; return ctx.state; }
const save = ctx => ctx.saveState(state(ctx));
function summary(record) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !['prompt', 'receipt', 'createdAt'].includes(key)));
}
export function delivery(receipt) {
  const stages = receipt?.stages ?? [];
  const started = receipt?.stage === 'turn_started' || receipt?.submission?.stage === 'turn_started' ||
    stages.some(stage => (typeof stage === 'string' ? stage : stage.stage ?? stage.name) === 'turn_started');
  if (started) return 'turn_started';
  if (receipt?.accepted === true || receipt?.input?.accepted === true || receipt?.stage === 'input_accepted' ||
      stages.some(stage => (typeof stage === 'string' ? stage : stage.stage ?? stage.name) === 'input_accepted')) return 'input_accepted';
  return 'unknown';
}
async function resolveHandle(record, cli, ctx) {
  if (record.terminalHandle) {
    try { await cli(['terminal', 'show', '--terminal', record.terminalHandle]); return record.terminalHandle; }
    catch (error) { if (!String(error).includes('terminal_handle_stale') && !String(error).includes('terminal_not_found')) throw error; }
  }
  const terminals = collection(await cli(['terminal', 'list', '--worktree', `id:${record.worktreeID}`]), 'terminals');
  const matches = terminals.filter(t => t.agentIdentity === record.agent || t.agent === record.agent || t.agentId === record.agent || t.agent?.id === record.agent || t.handle === record.terminalHandle);
  if (matches.length !== 1) fail('Agent terminal is missing or ambiguous. Select the intended terminal in Orca; no message was sent.');
  record.terminalHandle = matches[0].handle; await save(ctx); return record.terminalHandle;
}
async function ready(cli, handle) {
  for (const timeout of [60000, 90000]) {
    const result = await cli(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', String(timeout)], timeout / 1000 + 5);
    if (result.wait?.satisfied === true || result.satisfied === true) return true;
  }
  return false;
}
async function submit(args, ctx) {
  if (!isAbsolute(args.projectPath ?? '') || !args.prompt?.trim()) fail('An absolute Git project path and a nonempty prompt are required.');
  const agent = args.agent || ctx.configuration.default_agent || 'codex';
  if (!/^[a-zA-Z0-9_-]+$/.test(agent)) fail('Invalid Agent ID.');
  const cli = client(ctx), s = state(ctx), id = `orca-${shortID(ctx.requestID)}`;
  let record = s.handoffs[id];
  if (record) {
    // Recovery is read-only: never replay an uncertain create or prompt.
    return await recover(record, cli, ctx);
  }
  record = s.handoffs[id] = { handoffID: id, projectPath: canonical(args.projectPath), agent, prompt: args.prompt,
    name: `${(args.name || 'asky-task').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40)}-${shortID(ctx.requestID)}`,
    stage: 'not_submitted', createdAt: new Date().toISOString() };
  await save(ctx);
  try {
    let status = await cli(['status']);
    if (status.app?.running !== true) { await cli(['open']); status = await cli(['status']); }
    if (status.runtime?.reachable !== true) fail('Orca runtime is unavailable. Open Orca and retry after checking the handoff.');
    const repos = collection(await cli(['repo', 'list']), 'repos');
    let repo = repos.find(r => canonical(r.path ?? '') === record.projectPath);
    if (!repo) { const result = await cli(['repo', 'add', '--path', record.projectPath]); repo = result.repo ?? result; }
    if (!repo.id) fail('Orca did not return a repository ID.');
    record.repoID = repo.id; record.createAttempted = true; await save(ctx);
    const result = await cli(['worktree', 'create', '--repo', `id:${repo.id}`, '--name', record.name, '--no-parent', '--agent', agent], 60);
    const worktree = result.worktree ?? result;
    if (!worktree.id || !worktree.path) fail('Orca did not return the complete worktree identity.');
    record.worktreeID = worktree.id; record.worktreePath = worktree.path;
    record.terminalHandle = result.agentTerminalHandle ?? result.startupTerminal?.handle;
    await save(ctx);
    const handle = await resolveHandle(record, cli, ctx);
    if (!await ready(cli, handle)) { record.error = 'Agent is not ready; prompt was not sent.'; await save(ctx); return summary(record); }
    record.sendAttempted = true; record.stage = 'unknown'; await save(ctx);
    const receipt = await cli(['terminal', 'send', '--terminal', handle, '--text', args.prompt, '--enter', '--wait-submit', '10'], 15);
    record.receipt = receipt; record.submissionRequestID = receipt.requestId ?? receipt.requestID ?? receipt.submission?.requestId;
    record.stage = delivery(receipt); await save(ctx); return summary(record);
  } catch (error) {
    record.error = String(error.message ?? error);
    if (record.createAttempted && !record.worktreeID || record.sendAttempted) record.stage = 'unknown';
    await save(ctx); return summary(record);
  }
}
async function recover(record, cli, ctx) {
  if (!record.worktreeID && record.createAttempted && record.repoID) {
    const worktrees = collection(await cli(['worktree', 'list', '--repo', `id:${record.repoID}`]), 'worktrees');
    const matches = worktrees.filter(w => w.displayName === record.name || w.branch === record.name || w.path?.endsWith('/' + record.name));
    if (matches.length === 1) { record.worktreeID = matches[0].id; record.worktreePath = matches[0].path; if (!record.sendAttempted) record.stage = 'not_submitted'; await save(ctx); }
  }
  return summary(record);
}
async function query(args, ctx) {
  const record = state(ctx).handoffs[args.handoffID];
  if (!record) fail('Unknown handoff ID.');
  const cli = client(ctx); await recover(record, cli, ctx);
  if (!record.worktreeID) return summary(record);
  const worktree = await cli(['worktree', 'show', '--worktree', `id:${record.worktreeID}`]);
  const handle = await resolveHandle(record, cli, ctx);
  const terminal = await cli(['terminal', 'show', '--terminal', handle]);
  const output = await cli(['terminal', 'read', '--terminal', handle, '--limit', '200']);
  return { ...summary(record), worktree, terminal, output, note: 'Terminal state and output are observations, not proof that the development task is completed.' };
}
async function send(args, ctx) {
  const s = state(ctx), record = s.handoffs[args.handoffID];
  if (!record || !record.worktreeID) fail('Unknown or incomplete handoff.');
  if (!args.prompt?.trim()) fail('A nonempty prompt is required.');
  if (s.messages[ctx.requestID]) return summary(s.messages[ctx.requestID]);
  const cli = client(ctx), handle = await resolveHandle(record, cli, ctx);
  await cli(['terminal', 'read', '--terminal', handle, '--limit', '100']);
  const idle = await cli(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '60000'], 65);
  if (!(idle.wait?.satisfied ?? idle.satisfied)) return { handoffID: args.handoffID, stage: 'not_submitted', error: 'Agent is not ready; message was not sent.' };
  const message = s.messages[ctx.requestID] = { handoffID: args.handoffID, stage: 'unknown', prompt: args.prompt };
  await save(ctx);
  try {
    const receipt = await cli(['terminal', 'send', '--terminal', handle, '--text', args.prompt, '--enter', '--wait-submit', '10'], 15);
    message.stage = delivery(receipt); message.submissionRequestID = receipt.requestId ?? receipt.requestID ?? receipt.submission?.requestId; message.receipt = receipt;
  } catch (error) { message.error = String(error.message ?? error); }
  await save(ctx); return summary(message);
}
export default { tools: {
  submit_task: { execute: submit, async readback(_args, ctx) {
    const record = state(ctx).handoffs[`orca-${shortID(ctx.requestID)}`];
    if (!record) return null;
    await recover(record, client(ctx), ctx);
    return record.stage === 'unknown' ? null : summary(record);
  } },
  query_handoff: { execute: query },
  send_message: { execute: send, async readback(_args, ctx, output) {
    const record = state(ctx).messages[ctx.requestID];
    return record ? (record.stage === 'unknown' ? null : summary(record)) : output?.stage === 'not_submitted' ? output : null;
  } },
} };
