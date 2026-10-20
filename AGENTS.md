# Repository Guidelines

AI Agent 技能与工作流仓库（支持 pi 和 Claude Code）。内容以中文编写，供开发者和 AI Agent 协作维护。

pi 插件已拆分到独立仓库 `D:/code/pi-packages`（每个插件一个 npm 包），本仓库只维护技能与依赖技能的工作流。

## Project Structure & Module Organization

```
agents/               # agents 定义
skills/               # 个人技能（手写维护）
.agents/skills/       # 社区技能（npx skills 安装，已 gitignore）
workflows/            # 依赖技能的工作流脚本
.claude-plugin/       # Claude Code 插件配置
hooks/                # Claude Code hooks
docs/                 # 参考文档（plans/specs）
skills-lock.json      # 社区技能锁文件
package.json          # pi 配置：只声明 skills
```

## Build, Test, and Development Commands

- `npx skills experimental_install -y` — 按 `skills-lock.json` 安装/恢复社区技能到 `.agents/skills`。
- 修改技能后按技能内的验证步骤检查；工作流脚本按脚本内的用法手动运行。

## Coding Style & Naming Conventions

- 技能目录名用 kebab-case。
- 技能之间相互独立、不共享依赖；每个技能自带所需脚本。
- 文档、注释、提交信息以中文为主；提交信息遵循 Conventional Commits。
- `workflows/` 下的脚本可以依赖 `skills/` 中的技能内容；修改技能名称时同步检查这里，避免工作流失配。

## pi 插件

扩展代码、扩展开发约定（loader 验证、单测方式、包结构）与发布流程都在 `D:/code/pi-packages`，不在本仓库。需要修改 pi 扩展时去那个仓库。

## Commit & Pull Request Guidelines

- 提交信息遵循 Conventional Commits，作用域标注变更区域，例如 `feat(skills): ...`、`docs: ...`、`refactor(workflows): ...`。可用 `git-commit` 技能辅助生成。
- 只提交自己修改的代码；不要提交 `AGENTS.md`/`CLAUDE.md` 之外的无关文件。
- 切勿提交 API Token、密钥或凭证。
- `.pi/input-history/` 与 `.claude/hooks/` 是运行时数据，不提交（已在 `.gitignore`）。
- 更新既有技能需保持向后兼容，或记录破坏性变更。
