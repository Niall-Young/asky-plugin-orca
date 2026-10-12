import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import plugin, { delivery } from '../index.mjs';

function context(mode = {}) {
  const calls = [];
  const ctx = { configuration: { cli_path: '/chosen/orca' }, requestID: 'test-request', state: {},
    async saveState(value) { this.state = value; },
    async exec(executable, argv, options) {
      calls.push({ executable, argv, options });
      if (mode.failure) throw new Error('transport lost after mutation');
      if (mode.output) return mode.output;
      const result = argv[0] === 'repo' ? { repos: [{ id: 'agui', displayName: 'AGUI project', path: '/user/AGUI project' }] } : { send: { accepted: true } };
      return { exitCode: 0, stdout: JSON.stringify({ ok: true, result }), stderr: '' };
    } };
  return { ctx, calls };
}

test('discovers an opened project without any path supplied by user', async () => {
  const { ctx, calls } = context();
  const result = await plugin.tools.cli_query.execute({ arguments: ['repo', 'list'] }, ctx);
  assert.equal(result.result.repos[0].displayName, 'AGUI project');
  assert.equal(result.result.repos[0].id, 'agui');
  assert.deepEqual(calls[0].argv, ['repo', 'list', '--json']);
  assert.equal(calls[0].executable, '/chosen/orca');
  assert.deepEqual(ctx.state, {});
});

test('loads plain-text version-matched skills and command help', async () => {
  for (const argv of [['skills', 'get', 'orca-cli'], ['worktree', 'create', '--help'], ['help']]) {
    const { ctx, calls } = context({ output: { exitCode: 0, stdout: '# Current CLI guide', stderr: '' } });
    const result = await plugin.tools.cli_query.execute({ arguments: argv }, ctx);
    assert.equal(result.stdout, '# Current CLI guide');
    assert.deepEqual(calls[0].argv, argv);
  }
});

test('read tool refuses mutations and unknown commands before executing', async () => {
  const { ctx, calls } = context();
  for (const argv of [['repo', 'add', '--path', '/project'], ['terminal', 'send'], ['terminal', 'send', '--text', '--help'], ['open'], ['future', 'command'], ['status', '--unexpected']]) {
    await assert.rejects(plugin.tools.cli_query.execute({ arguments: argv }, ctx), /not classified/);
  }
  assert.equal(calls.length, 0);
});

test('CLI writes pass literal argv with repo ID and preserve prompt without shell interpolation', async () => {
  const { ctx, calls } = context();
  const argv = ['terminal', 'send', '--terminal', 'exact-handle', '--text', '中文\n"quotes" `literal` $(literal)', '--enter', '--json'];
  const result = await plugin.tools.cli_execute.execute({ arguments: argv, timeoutSeconds: 120 }, ctx);
  assert.equal(result.stage, 'command_returned');
  assert.equal(result.output.result.send.accepted, true);
  assert.deepEqual(calls[0].argv, argv);
  assert.equal(calls[0].options.timeoutSeconds, 120);
  await plugin.tools.cli_execute.execute({ arguments: argv }, ctx);
  assert.equal(calls.length, 1);
  assert.equal(ctx.state.commands[ctx.requestID].stage, 'command_returned');
  assert.equal(await plugin.tools.cli_execute.readback({}, ctx, result), null);
});

test('write checkpoint exists before CLI execution and unknown outcomes are never replayed', async () => {
  const { ctx, calls } = context({ failure: true });
  const exec = ctx.exec;
  ctx.exec = async (...args) => {
    assert.equal(ctx.state.commands[ctx.requestID].stage, 'unknown');
    return exec(...args);
  };
  const args = { arguments: ['worktree', 'create', '--repo', 'id:agui', '--agent', 'codex'] };
  const result = await plugin.tools.cli_execute.execute(args, ctx);
  assert.equal(result.stage, 'unknown');
  assert.match(result.error, /transport lost/);
  await plugin.tools.cli_execute.execute(args, ctx);
  await plugin.tools.cli_execute.readback(args, ctx, result);
  assert.equal(calls.length, 1);
});

test('rejects malformed argv and out-of-range timeouts before execution', async () => {
  const { ctx, calls } = context();
  for (const args of [{ arguments: [] }, { arguments: 'repo list' }, { arguments: [null] }, { arguments: ['repo\0'] }, { arguments: ['--pairing-code'] }, { arguments: ['status'], timeoutSeconds: 121 }, { arguments: ['status'], timeoutSeconds: 1.5 }]) {
    await assert.rejects(plugin.tools.cli_execute.execute(args, ctx));
  }
  assert.equal(calls.length, 0);
});

test('CLI errors remain errors; successful plain-text results remain available', async () => {
  for (const output of [{ exitCode: 1, stdout: 'failed', stderr: 'details' }, { exitCode: 0, stdout: '{"ok":false,"error":"unavailable"}', stderr: '' }]) {
    const { ctx } = context({ output });
    await assert.rejects(plugin.tools.cli_query.execute({ arguments: ['status'] }, ctx));
  }
});

test('manifest exposes CLI tools and removes the mandatory-path submission interface', async () => {
  const manifest = JSON.parse(await readFile(new URL('../asky-plugin.json', import.meta.url)));
  assert.deepEqual(manifest.tools.map(t => t.name).sort(), Object.keys(plugin.tools).sort());
  assert.equal(manifest.tools.find(t => t.name === 'cli_query').effect, 'read');
  assert.equal(manifest.tools.find(t => t.name === 'cli_execute').confirmation, 'explicitDirectOtherwiseConfirm');
  assert.equal(manifest.tools.some(t => t.inputSchema.required.includes('projectPath')), false);
});

test('legacy delivery receipts preserve acceptance versus turn-start semantics', () => {
  assert.equal(delivery({ accepted: true }), 'input_accepted');
  assert.equal(delivery({ send: { prompt: { stages: ['input_accepted', 'turn_started'] } } }), 'turn_started');
  assert.equal(delivery({ accepted: false }), 'unknown');
});

test('legacy handoff IDs can still be queried and followed up without duplicate sends', async () => {
  const { ctx, calls } = context();
  ctx.state.handoffs = { old: { handoffID: 'old', worktreeID: 'repo::/worktree', terminalHandle: 'handle', agent: 'codex', stage: 'input_accepted' } };
  const exec = ctx.exec;
  ctx.exec = async (exe, argv, options) => {
    if (argv[0] === 'terminal' && argv[1] === 'wait') {
      calls.push({ executable: exe, argv, options });
      return { exitCode: 0, stdout: JSON.stringify({ ok: true, result: { wait: { satisfied: true } } }), stderr: '' };
    }
    return exec(exe, argv, options);
  };
  const queried = await plugin.tools.query_handoff.execute({ handoffID: 'old' }, ctx);
  assert.equal(queried.terminalHandle, 'handle');
  assert.match(queried.note, /not proof/);
  const args = { handoffID: 'old', prompt: 'continue' };
  const sent = await plugin.tools.send_message.execute(args, ctx);
  assert.equal(sent.stage, 'input_accepted');
  await plugin.tools.send_message.execute(args, ctx);
  assert.equal(calls.filter(c => c.argv[1] === 'send').length, 1);
});
