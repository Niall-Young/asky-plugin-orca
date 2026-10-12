const fail = message => { throw new Error(message); };
const collection = (result, key) => Array.isArray(result) ? result : result?.[key] ?? [];
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
  receipt = receipt?.send ?? receipt;
  const stages = receipt?.prompt?.stages ?? receipt?.stages ?? [];
  const started = receipt?.stage === 'turn_started' || receipt?.submission?.stage === 'turn_started' ||
    stages.some(stage => (typeof stage === 'string' ? stage : stage.stage ?? stage.name) === 'turn_started');
  if (started) return 'turn_started';
  if (receipt?.accepted === true || receipt?.input?.accepted === true || receipt?.stage === 'input_accepted' ||
      stages.some(stage => (typeof stage === 'string' ? stage : stage.stage ?? stage.name) === 'input_accepted')) return 'input_accepted';
  return 'unknown';
}
async function resolveHandle(record, cli, ctx, selected) {
  if (selected) {
    const terminals = collection(await cli(['terminal', 'list', '--worktree', `id:${record.worktreeID}`]), 'terminals');
    if (!terminals.some(t => t.handle === selected && (t.agentIdentity === record.agent || t.agentId === record.agent || t.agent === record.agent))) fail('Selected terminal does not belong to the requested Agent in this worktree.');
    record.terminalHandle = selected; await save(ctx); return selected;
  }
  if (record.terminalHandle) {
    try { await cli(['terminal', 'show', '--terminal', record.terminalHandle]); return record.terminalHandle; }
    catch (error) { if (!String(error).includes('terminal_handle_stale') && !String(error).includes('terminal_not_found')) throw error; }
  }
  const terminals = collection(await cli(['terminal', 'list', '--worktree', `id:${record.worktreeID}`]), 'terminals');
  const matches = terminals.filter(t => t.agentIdentity === record.agent || t.agent === record.agent || t.agentId === record.agent || t.agent?.id === record.agent || t.handle === record.terminalHandle);
  if (matches.length !== 1) fail(`Agent terminal is missing or ambiguous. Ask the user to choose terminalHandle from ${JSON.stringify(matches.map(t => ({handle:t.handle, title:t.title})))}; no message was sent.`);
  record.terminalHandle = matches[0].handle; await save(ctx); return record.terminalHandle;
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
  const handle = await resolveHandle(record, cli, ctx, args.terminalHandle);
  const terminal = await cli(['terminal', 'show', '--terminal', handle]);
  const output = await cli(['terminal', 'read', '--terminal', handle, '--limit', '200']);
  return { ...summary(record), worktree, terminal, output, note: 'Terminal state and output are observations, not proof that the development task is completed.' };
}
async function send(args, ctx) {
  const s = state(ctx), record = s.handoffs[args.handoffID];
  if (!record || !record.worktreeID) fail('Unknown or incomplete handoff.');
  if (!args.prompt?.trim()) fail('A nonempty prompt is required.');
  if (s.messages[ctx.requestID]) return summary(s.messages[ctx.requestID]);
  const cli = client(ctx), handle = await resolveHandle(record, cli, ctx, args.terminalHandle);
  await cli(['terminal', 'read', '--terminal', handle, '--limit', '100']);
  const idle = await cli(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '60000'], 65);
  if (!(idle.wait?.satisfied ?? idle.satisfied)) return { handoffID: args.handoffID, stage: 'not_submitted', error: 'Agent is not ready; message was not sent.' };
  const message = s.messages[ctx.requestID] = { handoffID: args.handoffID, stage: 'unknown', prompt: args.prompt };
  await save(ctx);
  try {
    const receipt = await cli(['terminal', 'send', '--terminal', handle, '--text', args.prompt, '--enter', '--wait-submit', '10'], 15);
    message.stage = delivery(receipt); message.submissionRequestID = receipt.mutation?.requestId ?? receipt.send?.prompt?.requestId ?? receipt.requestId ?? receipt.requestID ?? receipt.submission?.requestId; message.receipt = receipt;
  } catch (error) { message.error = String(error.message ?? error); }
  await save(ctx); return summary(message);
}
// Only documented observations are accepted through the read tool. Unknown commands
// remain available through the write tool and the host's authorization policy.
const readCommands = new Set([
  'repo list', 'repo show', 'repo search-refs',
  'worktree list', 'worktree ps', 'worktree current', 'worktree show',
  'terminal list', 'terminal show', 'terminal read', 'terminal wait',
  'skills get', 'artifacts list',
]);
function commandArgs(args) {
  const argv = args.arguments;
  if (!Array.isArray(argv) || !argv.length || argv.some(a => typeof a !== 'string' || a.includes('\0')))
    fail('arguments must be a nonempty array of CLI argument strings, without the executable.');
  if (!argv[0] || argv[0].startsWith('-') && !['--help', '--version'].includes(argv[0]))
    fail('Start arguments with an Orca command.');
  if (args.timeoutSeconds !== undefined && (!Number.isInteger(args.timeoutSeconds) || args.timeoutSeconds < 1 || args.timeoutSeconds > 120))
    fail('timeoutSeconds must be an integer from 1 to 120.');
  return argv;
}
function isReadCommand(argv) {
  const commandWords = words => words.every(word => /^[a-z][a-z0-9-]*$/.test(word));
  if (argv.length === 1 && ['--version', '--help'].includes(argv[0])) return true;
  if (argv[0] === 'help' && commandWords(argv.slice(1))) return true;
  if (argv.at(-1) === '--help' && commandWords(argv.slice(0, -1))) return true;
  if (argv[0] === 'status') return argv.length === 1 || argv.slice(1).every(a => a === '--json');
  // Classify by the actual command prefix; help flags used as argument values
  // must not turn a mutation into an observation.
  return readCommands.has(argv.slice(0, 2).join(' '));
}
async function runCommand(args, ctx, argv) {
  const text = argv[0] === 'skills' || argv[0] === 'help' || argv.includes('--help') || argv.includes('--version');
  const output = await ctx.exec(ctx.configuration.cli_path || 'orca',
    text || argv.includes('--json') ? argv : [...argv, '--json'],
    { timeoutSeconds: args.timeoutSeconds ?? 20 });
  let envelope;
  try { envelope = JSON.parse(output.stdout); } catch { /* CLI help and skills are plain text. */ }
  if (output.exitCode !== 0 || envelope?.ok === false)
    fail(JSON.stringify(envelope?.error ?? { exitCode: output.exitCode, stdout: output.stdout, stderr: output.stderr }));
  return { exitCode: output.exitCode, ...(envelope ? { result: envelope.result ?? envelope } : { stdout: output.stdout }),
    ...(output.stderr ? { stderr: output.stderr } : {}) };
}
async function cliQuery(args, ctx) {
  const argv = commandArgs(args);
  if (!isReadCommand(argv)) fail('This command is not classified as read-only. Use cli_execute with the host authorization policy.');
  return runCommand(args, ctx, argv);
}
async function cliExecute(args, ctx) {
  const argv = commandArgs(args);
  const s = state(ctx); s.commands ??= {};
  const existing = s.commands[ctx.requestID];
  if (existing) return existing;
  const record = s.commands[ctx.requestID] = { arguments: argv, stage: 'unknown' };
  await save(ctx);
  try {
    record.output = await runCommand(args, ctx, argv);
    record.stage = 'command_returned';
  } catch (error) { record.error = String(error.message ?? error); }
  await save(ctx);
  return record;
}
export default { tools: {
  cli_query: { execute: cliQuery },
  cli_execute: { execute: cliExecute, async readback() {
    // Arbitrary CLI writes need command-specific observations. Never replay here.
    return null;
  } },
  query_handoff: { execute: query },
  send_message: { execute: send, async readback(_args, ctx, output) {
    const record = state(ctx).messages[ctx.requestID];
    return record ? (record.stage === 'unknown' ? null : summary(record)) : output?.stage === 'not_submitted' ? output : null;
  } },
} };
