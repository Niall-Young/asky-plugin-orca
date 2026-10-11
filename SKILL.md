# Orca task handoff

Use plugin_orca__submit_task when the user explicitly asks to give a development task to Orca or launch an Agent there.

- Require an absolute Git repository path and the actual task prompt. Ask when the project is missing or ambiguous; never use Asky's runtime directory as the project.
- Respect a specified Agent ID; otherwise use the plugin default. Do not invent model/effort launch arguments.
- The plugin creates an independent worktree from the repository default base. Uncommitted changes in the original checkout are not copied. If the task depends on those changes, explain this and ask the user to prepare a committed base.
- Return the handoff ID, Agent, worktree path, and delivery stage. `input_accepted` means input accepted; `turn_started` means a turn was observed to start. Neither means the task completed.
- `not_submitted` means prompt not sent; `unknown` and native pendingVerification mean the outcome is uncertain. Never automatically recreate the worktree or resend the prompt.
- Stop after handoff. Query progress with plugin_orca__query_handoff only when asked. Terminal idle does not prove task completion.
- Use plugin_orca__send_message only for user-requested follow-ups. Do not automatically merge, delete worktrees, publish, or stop the receiving Agent.
