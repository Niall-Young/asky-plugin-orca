---
name: asky-orca-cli
description: Operate Orca through its installed CLI when the user asks to inspect projects, manage workspaces, launch an Agent, hand off work, or use other Orca capabilities.
---

# Orca CLI

The plugin connects the configured Orca executable to Asky's ToolService. Choose CLI commands from the installed version's documentation, rather than a fixed plugin workflow.

## Discover before acting

Use `plugin_orca__cli_query` with `arguments: ["skills", "get", "orca-cli"]` at the start of Orca work. Read that guide and load its relevant references through the same tool. Use command `--help` when further flags are needed. If this version explicitly rejects `skills get`, use command help and the read-only inventory; do not invent flags or silently switch executables.

Use `arguments: ["status"]` to check availability and `["repo", "list"]` to discover projects. Match the user's project name against returned display names and paths; use the returned exact repo ID in commands. When several projects match, show their names and ask which one. If no project was named, show the inventory and ask which project. Do not pick Asky's installation/runtime directory or infer the focused project from the plugin's working directory. An already opened project does not require a user-supplied absolute path. Only adding a new project needs its actual directory.

## Execute and verify

`plugin_orca__cli_query` runs help, skill discovery and classified read commands. `plugin_orca__cli_execute` runs other CLI commands within the user's requested scope and the host's write policy. Both take an `arguments` array without the executable; optional `timeoutSeconds` is 1–120. Pass literal argv, never shell command strings. Commands whose read classification is unknown can use cli_execute with the host write policy.

Follow the live guide for worktree creation, terminal readiness, prompt submission, browser operations, and other tasks. Respect the user's Agent, checkout, model and effort choices. For a handoff with no checkout preference, prefer an independent worktree from the repo default base. State if required uncommitted changes would be absent there.

Write calls persist a request checkpoint before execution. `command_returned` proves only that the CLI returned successfully; inspect its actual result and use cli_query for command-specific observations. Native pendingVerification and `unknown` mean uncertainty. Never repeat an uncertain create or send automatically. Readback never replays writes. A retry with the same host request ID returns the saved record.

For a handoff, report the full worktree ID, Agent terminal handle and actual send receipt. `input_accepted` and `turn_started` do not prove task completion. Stop after confirmed acceptance unless asked to monitor. Do not automatically merge, publish, delete, or stop Agents.

`plugin_orca__query_handoff` and `plugin_orca__send_message` support handoff IDs saved by older plugin versions. For new CLI workflows, use the returned repo/worktree IDs and terminal handles directly. On stale or ambiguous terminal handles, re-list and resolve the intended Agent; never dual-send or guess.
