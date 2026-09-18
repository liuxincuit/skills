# Repository Guidelines

AI Agent 技能与插件仓库（支持 pi 和 Claude Code）。内容以中文编写，供开发者和 AI Agent 协作维护。

## Project Structure & Module Organization

```
agents/               # agents 定义
skills/               # 个人技能（手写维护）
.agents/skills/       # 社区技能（npx skills 安装，已 gitignore）
pi/extensions/        # pi 扩展，每个扩展一个子目录（index.ts 入口 + README.md）
pi/prompts/           # pi 提示词模板
pi/workflow/          # pi 工作流（依赖技能）
.claude-plugin/       # Claude Code 插件配置
hooks/                # Claude Code hooks
docs/                 # 参考文档（plans/specs）
skills-lock.json      # 社区技能锁文件
package.json          # pi 配置：extensions/skills/prompts 声明
```

## Build, Test, and Development Commands

- `npx skills experimental_install -y` — 按 `skills-lock.json` 安装/恢复社区技能到 `.agents/skills`。
- 仓库无 `node_modules`。验证 pi 扩展：在临时目录安装 `@earendil-works/pi-coding-agent`，用 esbuild 打包（`--external:@earendil-works/*`）后运行。详见 `skills/pi-extension-dev/`。

## Coding Style & Naming Conventions

- pi 扩展必须放在 `pi/extensions/`（无点前缀），并经 `package.json` 的 `pi.extensions` 声明加载；`.pi/extensions/` 不是插件目录。
- 扩展按目录组织：`pi/extensions/<kebab-case-name>/index.ts` 为唯一入口，同目录放该扩展的 `README.md`。
- 入口文件必须是 `index.ts`：pi 只扫描 `pi/extensions/` 一层，子目录仅识别 `index.ts` / `index.js` / 带 `pi` 字段的 `package.json`。同目录的辅助模块、测试文件与 README 不会被当作扩展加载。
- 扩展 README 按「做什么 / 配置 / 调试 / 陷阱」四节组织，配置项、命令、事件挂载点与已知坑写在这里，不在根 README 重复维护。
- 技能目录名用 kebab-case。
- 技能之间相互独立、不共享依赖；每个技能自带所需脚本。
- 文档、注释、提交信息以中文为主；提交信息遵循 Conventional Commits。

## Testing Guidelines

- 仓库无自动化测试套件；质量保障靠验证与审查。
- 修改 pi 扩展后必须 esbuild 打包验证语法与加载；新增/修改技能后按技能内的验证步骤检查。
- 技能名称更新时，同步检查 `pi/workflow` 中引用，避免工作流失配。

## Commit & Pull Request Guidelines

- 提交信息遵循 Conventional Commits，作用域标注变更区域，例如 `feat(extensions): ...`、`docs: ...`、`refactor(extensions): ...`。可用 `git-commit` 技能辅助生成。
- 只提交自己修改的代码；不要提交 `AGENTS.md`/`CLAUDE.md` 之外的无关文件。
- 切勿提交 API Token、密钥或凭证。
- `.pi/input-history/` 与 `.claude/hooks/` 是运行时数据，不提交（已在 `.gitignore`）。
- 更新既有技能需保持向后兼容，或记录破坏性变更。
