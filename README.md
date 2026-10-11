# Orca plugin for Asky

[中文](#中文) | [English](#english)

<a id="中文"></a>
## 中文

### 项目简介

Asky 官方 Orca 插件。把开发任务交给 Orca：添加或复用 Git 项目，创建独立 worktree，启动指定 Agent，提交 prompt。插件独立于 Asky 发布，不进入应用安装包。

### 核心能力

- 提交开发任务并返回交接 ID、工作区和接收阶段。
- 按需查询状态与终端输出，发送后续消息。
- 保存阶段记录，遇到未知结果不盲目重复创建或提交。

### 快速开始

在支持插件 API v1 的 Asky 中，打开“设置 › 插件”，安装官方 Orca 插件，或添加：

```text
https://github.com/Niall-Young/asky-plugin-orca
```

插件无 npm 依赖，使用 Asky 随包的 Node。需要安装 Orca、其 CLI 和你选择的 Agent，并完成该 Agent 的登录/配置。插件会执行本机代码，只安装你信任的来源。

### 使用方法

向 Asky 提交：

> 将 /absolute/path/to/project 添加到 Orca，启动 Codex，帮我检查项目测试失败的原因。

默认创建独立 worktree，使用项目默认 base；原目录未提交的修改不会复制过去。未指定 Agent 时使用 `codex`。交接完成后可要求查询交接 ID 的进度，或向它发送后续任务。终端匹配不唯一时，选择返回候选中的 terminalHandle 再查询或发送。

`input_accepted` 只表示输入已接收，`turn_started` 表示观察到 Agent 开始执行；两者都不表示开发任务完成。`not_submitted` 表示尚未发送，`unknown` 表示需核实。不会自动合并、发布、删除工作区或停止 Agent。

### 配置

- `cli_path`：默认 `orca`，也可填写指定 Orca CLI 的绝对路径。不静默切换安装。
- `default_agent`：默认 `codex`，可填写 Orca 支持且已安装的 Agent ID。

### 项目结构

`asky-plugin.json` 声明工具与配置，`index.mjs` 实现流程，`SKILL.md` 提供 Agent 操作指导。适合作为 Asky 插件模板；修改插件 ID 后发布到自己的 GitHub 仓库即可。

### 开发与验证

需要 Node.js 22 或更新版本，无需安装依赖：

```sh
npm test
```

测试模拟 Orca CLI 的正常交接、超时、未知结果、终端恢复和后续消息。真实环境验证记录位于 `docs/validation/`。

### 许可证

MIT。官方插件由维护者审核；用户自行安装的插件与官方插件使用相同接口，不提供系统沙箱。

<a id="english"></a>
## English

### Overview

The official Orca plugin for Asky hands development tasks to Orca: add or reuse a Git project, create an independent worktree, launch the requested Agent, and submit a prompt. It ships separately from Asky and is not included in the app bundle.

### Features

- Submit a task and return its handoff ID, workspace, and delivery stage.
- Query status and terminal output on demand, or send follow-up prompts.
- Persist checkpoints without blindly replaying an uncertain create or submission.

### Quick Start

In Asky with plugin API v1 support, open Settings › Plugins and install Orca from the official list, or add:

```text
https://github.com/Niall-Young/asky-plugin-orca
```

The plugin has no npm dependencies and uses Asky's bundled Node. Install Orca, its CLI, and your selected Agent, and complete that Agent's authentication/configuration. Plugins execute local code; only install sources you trust.

### Usage

Ask Asky:

> Add /absolute/path/to/project to Orca, launch Codex, and investigate the failing tests.

The default is an independent worktree from the repository default base. Uncommitted changes in the original checkout are not copied. The default Agent is `codex`. Ask to query the returned handoff ID or send it a follow-up prompt. If terminal matching is ambiguous, choose a returned candidate terminalHandle before querying or sending.

`input_accepted` means input was accepted; `turn_started` means an Agent turn was observed to start. Neither proves task completion. `not_submitted` means no prompt was sent; `unknown` requires verification. The plugin does not automatically merge, publish, delete workspaces, or stop Agents.

### Configuration

- `cli_path`: defaults to `orca`; an absolute CLI path selects a specific installation without silently switching builds.
- `default_agent`: defaults to `codex`; set an Agent ID supported by Orca and installed locally.

### Project Structure

`asky-plugin.json` declares tools and configuration, `index.mjs` implements the workflow, and `SKILL.md` supplies Agent guidance. Copy this structure, change the plugin ID, and publish your own GitHub repository to create another Asky plugin.

### Development and Verification

Requires Node.js 22 or newer. No dependency installation is needed:

```sh
npm test
```

Tests simulate normal handoffs, timeouts, uncertain outcomes, terminal recovery, and follow-up prompts. Live validation records are in `docs/validation/`.

### License

MIT. Official plugins are reviewed by the maintainer. User-installed plugins use the same interface; there is no OS sandbox.
