# Orca plugin for Asky

[中文](#中文) | [English](#english)

<a id="中文"></a>
## 中文

### 项目简介

Asky 官方 Orca 插件，以 skill 指导 Agent 操作本机 Orca CLI。按当前版本文档发现项目、管理工作区、交接任务或使用其他 CLI 能力。插件独立于 Asky 发布，不进入应用安装包。

### 核心能力

- 读取本机 Orca 的实时 skill 与命令帮助，按项目名发现已打开项目。
- 通用 `cli_query` / `cli_execute` 以 argv 调用 CLI，读写经过 ToolService。
- 兼容旧版交接 ID 的查询与后续消息。
- 保存阶段记录，遇到未知结果不盲目重复创建或提交。

### 快速开始

在支持插件 API v1 的 Asky 中，打开“设置 › 插件”，安装官方 Orca 插件，或添加：

```text
https://github.com/Niall-Young/asky-plugin-orca
```

插件无 npm 依赖，使用 Asky 随包的 Node。需要安装 Orca、其 CLI 和你选择的 Agent，并完成该 Agent 的登录/配置。插件会执行本机代码，只安装你信任的来源。

### 使用方法

向 Asky 提交：

> 将 Orca 里已经打开的 AGUI 项目交给 Codex，帮我检查测试失败的原因。

Agent 先通过 `cli_query` 读取 `skills get orca-cli`，再用 `repo list` 按项目名称找到 repo ID；有多个匹配才需要选择，已打开项目无需提供绝对路径。新项目添加才需要目录。操作步骤与参数以实时 CLI 文档为准，支持用户指定 Agent 与工作区。交接默认使用独立 worktree 和项目默认 base，原目录未提交修改不会复制过去。后续操作使用返回的 worktree ID 与 terminal handle；旧版交接 ID 仍可查询和发送消息。

`command_returned` 仅表示 CLI 成功返回。通用写命令的原生回读保留 pendingVerification，Agent 必须按具体命令查询目标，不自动重放。`cli_query` 对未分类命令会拒绝，可经 `cli_execute` 使用宿主写策略执行。

`input_accepted` 只表示输入已接收，`turn_started` 表示观察到 Agent 开始执行；两者都不表示开发任务完成。`not_submitted` 表示尚未发送，`unknown` 表示需核实。不会自动合并、发布、删除工作区或停止 Agent。

### 配置

- `cli_path`：默认 `orca`，也可填写指定 Orca CLI 的绝对路径。不静默切换安装。

### 项目结构

`asky-plugin.json` 声明工具与配置，`index.mjs` 实现流程，`SKILL.md` 提供 Agent 操作指导。适合作为 Asky 插件模板；修改插件 ID 后发布到自己的 GitHub 仓库即可。

### 开发与验证

需要 Node.js 22 或更新版本，无需安装依赖：

```sh
npm test
```

测试覆盖 CLI 文档读取、项目发现、读写分类、字面 argv、超时参数、未知结果去重与旧版交接兼容。真实环境验证记录位于 `docs/validation/`。

### 许可证

MIT。官方插件由维护者审核；用户自行安装的插件与官方插件使用相同接口，不提供系统沙箱。

<a id="english"></a>
## English

### Overview

The official Orca plugin for Asky guides the Agent through a skill to operate the installed Orca CLI. Discover projects, manage workspaces, hand off tasks, and use other CLI capabilities from version-matched documentation. It ships separately from Asky and is not included in the app bundle.

### Features

- Load installed Orca skills and command help; discover opened projects by name.
- Invoke CLI argv through generic `cli_query` / `cli_execute` tools under ToolService policy.
- Continue querying and following up on legacy handoff IDs.
- Persist checkpoints without blindly replaying an uncertain create or submission.

### Quick Start

In Asky with plugin API v1 support, open Settings › Plugins and install Orca from the official list, or add:

```text
https://github.com/Niall-Young/asky-plugin-orca
```

The plugin has no npm dependencies and uses Asky's bundled Node. Install Orca, its CLI, and your selected Agent, and complete that Agent's authentication/configuration. Plugins execute local code; only install sources you trust.

### Usage

Ask Asky:

> Hand the AGUI project already opened in Orca to Codex and investigate the failing tests.

The Agent first loads `skills get orca-cli` through `cli_query`, then discovers the repo ID by project name with `repo list`. Choose among candidates when names are ambiguous; opened projects need no user-supplied absolute path. Adding a new project needs its directory. Commands and flags come from the live CLI guide, respecting the requested Agent and checkout. Handoffs default to an independent worktree from the repository default base; uncommitted changes are not copied. Use returned worktree IDs and terminal handles for follow-ups; legacy handoff IDs remain supported.

`command_returned` only means the CLI returned successfully. Generic writes retain native pendingVerification and require command-specific target queries without replaying. Unclassified read commands can run through `cli_execute` under the host write policy.

`input_accepted` means input was accepted; `turn_started` means an Agent turn was observed to start. Neither proves task completion. `not_submitted` means no prompt was sent; `unknown` requires verification. The plugin does not automatically merge, publish, delete workspaces, or stop Agents.

### Configuration

- `cli_path`: defaults to `orca`; an absolute CLI path selects a specific installation without silently switching builds.

### Project Structure

`asky-plugin.json` declares tools and configuration, `index.mjs` implements the workflow, and `SKILL.md` supplies Agent guidance. Copy this structure, change the plugin ID, and publish your own GitHub repository to create another Asky plugin.

### Development and Verification

Requires Node.js 22 or newer. No dependency installation is needed:

```sh
npm test
```

Tests cover CLI guide loading, project discovery, read/write classification, literal argv, timeout validation, uncertain-write deduplication, and legacy handoff compatibility. Live validation records are in `docs/validation/`.

### License

MIT. Official plugins are reviewed by the maintainer. User-installed plugins use the same interface; there is no OS sandbox.
