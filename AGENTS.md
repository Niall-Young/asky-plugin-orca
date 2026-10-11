# Asky Orca plugin

这是独立发布的 Asky 插件，使用 JavaScript ESM，兼容插件 API v1。工具声明、实现与使用约束分别在 asky-plugin.json、index.mjs 和 SKILL.md；保持三者一致。

- 通过宿主 context.exec 调用 Orca CLI，通过 context.saveState 保存交接记录；不自行启动 Shell 或读写用户项目。
- 修改后运行 npm test。真实 Orca 验证与模拟测试分别记录在 docs/validation/，不得从输入接收推断任务完成。
- 安装、配置和开发命令同步维护中英文 README。
