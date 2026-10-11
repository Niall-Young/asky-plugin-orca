import test from 'node:test';
import assert from 'node:assert/strict';
import plugin, { delivery } from '../index.mjs';

function context(mode = {}) {
  const calls = [];
  const ctx = { configuration: { default_agent: 'codex', cli_path: '/chosen/orca' }, requestID: 'test-request', state: {},
    async saveState(value) { this.state = value; },
    async exec(executable, args) {
      calls.push({ executable, args });
      const key = args.slice(0, 2).join(' ');
      let result;
      if (args[0] === 'status') result = { app: { running: true }, runtime: { reachable: true } };
      else if (key === 'repo list') result = { repos: mode.existing ? [{ id: 'repo', path: '/project' }] : [] };
      else if (key === 'repo add') result = { repo: { id: 'repo' } };
      else if (key === 'worktree create') {
        if (mode.createFailure) throw new Error('transport lost after create');
        result = { worktree: { id: 'repo::/new/worktree', path: '/new/worktree' }, agentTerminalHandle: 'handle' };
      } else if (key === 'worktree list') result = { worktrees: [{ id: 'repo::/new/worktree', path: '/new/worktree', displayName: Object.values(ctx.state.handoffs)[0].name }] };
      else if (key === 'terminal wait') result = { wait: { satisfied: !mode.notReady } };
      else if (key === 'terminal send') {
        if (mode.sendFailure) throw new Error('transport lost after send');
        result = { send: { accepted: true, prompt: { requestId: 'submission', stages: mode.started ? ['input_accepted', 'turn_started'] : ['input_accepted'] } }, mutation: { requestId: 'submission' } };
      } else if (key === 'terminal show' && mode.stale && args.includes('handle')) throw new Error('terminal_handle_stale');
      else if (key === 'terminal list') result = { terminals: mode.ambiguous ? [{ handle: 'a', agentIdentity: 'codex' }, { handle: 'b', agentIdentity: 'codex' }] : [{ handle: 'replacement', agentIdentity: 'codex' }] };
      else result = {};
      return { exitCode: 0, stdout: JSON.stringify({ ok: true, result }), stderr: '' };
    } };
  return { ctx, calls };
}
const args = { projectPath: '/project', prompt: '保持原文\n"quotes" `literal` $(literal)', agent: 'codex' };

test('adds repo, starts one Agent, preserves prompt argv, and returns receipt without waiting for completion', async () => {
  const { ctx, calls } = context();
  const result = await plugin.tools.submit_task.execute(args, ctx);
  assert.equal(result.stage, 'input_accepted'); assert.equal(result.submissionRequestID, 'submission');
  assert.equal(calls.filter(c => c.args[0] === 'repo' && c.args[1] === 'add').length, 1);
  assert.equal(calls.filter(c => c.args[1] === 'create').length, 1);
  assert.ok(calls.find(c => c.args[1] === 'create').args.includes('--no-parent'));
  assert.equal(calls.find(c => c.args[1] === 'send').args[calls.find(c => c.args[1] === 'send').args.indexOf('--text') + 1], args.prompt);
  assert.ok(calls.every(c => c.executable === '/chosen/orca'));
  assert.equal((await plugin.tools.submit_task.readback(args, ctx)).stage, 'input_accepted');
  const count = calls.length;
  assert.equal((await plugin.tools.submit_task.execute(args, ctx)).stage, 'input_accepted'); assert.equal(calls.length, count);
});
test('reuses project and distinguishes observed turn start', async () => {
  const { ctx, calls } = context({ existing: true, started: true });
  assert.equal((await plugin.tools.submit_task.execute(args, ctx)).stage, 'turn_started');
  assert.ok(!calls.some(c => c.args[1] === 'add'));
});
test('readiness timeout never sends prompt', async () => {
  const { ctx, calls } = context({ notReady: true });
  assert.equal((await plugin.tools.submit_task.execute(args, ctx)).stage, 'not_submitted');
  assert.equal(calls.filter(c => c.args[1] === 'wait').length, 2); assert.ok(!calls.some(c => c.args[1] === 'send'));
});
test('uncertain create is recovered without recreating or sending', async () => {
  const { ctx, calls } = context({ createFailure: true });
  assert.equal((await plugin.tools.submit_task.execute(args, ctx)).stage, 'unknown');
  assert.equal((await plugin.tools.submit_task.readback(args, ctx)).stage, 'not_submitted');
  await plugin.tools.submit_task.execute(args, ctx);
  assert.equal(calls.filter(c => c.args[1] === 'create').length, 1); assert.ok(!calls.some(c => c.args[1] === 'send'));
});
test('ambiguous send stays unverified and is never replayed', async () => {
  const { ctx, calls } = context({ sendFailure: true });
  await plugin.tools.submit_task.execute(args, ctx);
  assert.equal(await plugin.tools.submit_task.readback(args, ctx), null);
  await plugin.tools.submit_task.execute(args, ctx);
  assert.equal(calls.filter(c => c.args[1] === 'send').length, 1);
});
test('query recovers stale handle, reports observations, and follow-up is deduplicated', async () => {
  const { ctx, calls } = context();
  const initial = await plugin.tools.submit_task.execute(args, ctx);
  ctx.requestID = 'follow-up';
  await plugin.tools.send_message.execute({ handoffID: initial.handoffID, prompt: 'next' }, ctx);
  await plugin.tools.send_message.execute({ handoffID: initial.handoffID, prompt: 'next' }, ctx);
  assert.equal(calls.filter(c => c.args[1] === 'send').length, 2);
  const queried = await plugin.tools.query_handoff.execute({ handoffID: initial.handoffID }, ctx);
  assert.match(queried.note, /not proof/);
});
test('stale handles rebind to one Agent; ambiguous matches refuse sending', async () => {
  for (const ambiguous of [false, true]) {
    const { ctx, calls } = context({ stale: true, ambiguous });
    const result = await plugin.tools.submit_task.execute(args, ctx);
    assert.equal(result.stage, ambiguous ? 'not_submitted' : 'input_accepted');
    assert.equal(calls.filter(c => c.args[1] === 'send').length, ambiguous ? 0 : 1);
  }
});
test('validates required project and Agent values', async () => {
  const { ctx, calls } = context();
  await assert.rejects(plugin.tools.submit_task.execute({ ...args, projectPath: 'relative' }, ctx));
  await assert.rejects(plugin.tools.submit_task.execute({ ...args, agent: 'codex --unsafe' }, ctx));
  assert.equal(calls.length, 0);
});
test('delivery never infers completion from acceptance', () => {
  assert.equal(delivery({ accepted: true }), 'input_accepted');
  assert.equal(delivery({ accepted: false }), 'unknown');
});

test('explicit terminal choice resolves an ambiguous handoff and rejects foreign handles', async () => {
  const { ctx } = context({ stale: true, ambiguous: true });
  const record = await plugin.tools.submit_task.execute(args, ctx);
  await assert.rejects(plugin.tools.query_handoff.execute({ handoffID: record.handoffID, terminalHandle: 'foreign' }, ctx));
  const query = await plugin.tools.query_handoff.execute({ handoffID: record.handoffID, terminalHandle: 'a' }, ctx);
  assert.equal(query.terminalHandle, 'a');
});
