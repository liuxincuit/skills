---
name: retrospective
description: Use after completing a task to review the conversation and determine whether to update user preferences, project conventions, or skills. Call this manually when a task is done — don't wait for the user to ask. If you see repeated patterns (user corrected you on something, you wrote a script to work around a skill's limitation, you discovered a tool quirk), proactively mention that a retrospective would be useful.
---

# Retrospective

Review the conversation context after completing a task and identify what should be updated for future sessions.

## 触发条件

任务完成后手动调用。适合在以下场景回顾：

- 用户纠正了你的行为或表达过偏好
- 你发现某个 skill 的指令模糊、脚本报错、或缺少所需功能
- 你写了一段临时脚本/手动操作来绕过某个 skill 的限制
- 你发现了环境配置、工具行为、或项目约定的特殊之处
- 用户说了一些看起来像是通用偏好或规则的话

## 核心流程

```
1. 分析当前对话上下文
2. 识别三类信号: 用户偏好 / 约定 / 技能
3. 列出每类建议的变更, 逐类让用户确认
4. 用户确认后执行修改
```

如果是空对话（没有历史上下文），要求用户提供对话历史文件路径。

## 类别 A：用户偏好

**保存位置:** 当前 AI Agent 的用户级配置文件。

- **dsh（DeepSeek Harness）:** `$DSH_HOME/AGENTS.md`（默认 `~/.dsh/AGENTS.md`；DSH 用户全局**只认 AGENTS.md**，不认 CLAUDE.md）
- **pi:** `~/.pi/agent/AGENTS.md`
- **Claude Code:** `~/.claude/CLAUDE.md`
- 不确定当前使用哪个 Agent 时：检查 `$HOME` 下存在哪个目录——`.dsh/`（含 `sessions/`、`settings.yaml`）→ dsh；`.pi/` → pi；`.claude/` → Claude Code。dsh 的默认位置可被环境变量 `DSH_HOME` 覆盖

在文件中追加到 `## 用户偏好（由 retrospective 管理）` 一节。如果该节不存在则创建。

**识别信号：**
- 用户明确表达喜好：如"我喜欢用 Python 做数据处理"、"我不希望你自动安装包"
- 用户反复纠正你的某种行为模式
- 用户强调某种做事方式是他一贯的风格

**什么不算：**
- 一次性需求（"这次用 Node.js 跑" → 不是偏好）
- 项目特有的约定（应归入类别 B）
- 与对话任务无关的猜测

**已有规则违反处理：**
- 如果本次对话中违反了已有规则，在该规则后追加 `（违反 N 次：YYYY-MM-DD，违反场景简述）`
- 如果已有记录，递增 N，追加新日期和场景
- 示例：`- 默认只分析和回答问题（违反 2 次：2025-06-22，场景A；2025-07-01，场景B）`

**更新格式：**
```markdown
## 用户偏好（由 retrospective 管理）

- 用 Python 处理数据分析类任务，不要主动安装全局 npm 包
- 默认使用 conventional commit 格式
```

## 类别 B：约定

### 全局约定

**保存位置:** 与用户偏好同一个文件（`~/.dsh/AGENTS.md`、`~/.pi/agent/AGENTS.md` 或对应 Agent 的用户级配置文件），追加到 `## 全局约定（由 retrospective 管理）` 一节。

**识别信号：**
- 开发环境配置（操作系统、包管理器、路径风格）
- 工具怪癖和已知坑（参考 `understand-pitfalls` 的模式）
- 跨项目通用的经验教训
- 非显而易见的工具行为限制

**更新格式：**
```markdown
## 全局约定（由 retrospective 管理）

### 环境
- Windows 开发环境，路径使用 MSYS 风格（`/c/Users/...`）
- pnpm 包管理器，避免 npm/yarn

### 工具怪癖
- pnpm approve-builds 是交互式命令，不能在脚本中非交互执行
- ...

### 经验教训
- ...
```

### 项目约定

**保存位置:** 项目根目录，按以下优先级确定写入文件：
1. 如果项目根目录存在 `AGENTS.md`，追加到该文件
2. 如果不存在，但存在 `CLAUDE.md`，追加到该文件
3. 如果两者都不存在，创建 `AGENTS.md` 并写入

**识别信号：**
- 该项目特有的代码规范、命名约定
- 项目特有的构建步骤、测试要求
- 项目依赖的特殊服务、端口、环境变量
- 项目目录结构和文件组织惯例

**更新格式：**
追加到选定的规则文件中，保持文件已有的风格（如果文件是 `AGENTS.md` 则用 `## 项目约定（由 retrospective 管理）` 作为节标题）。

## 类别 C：技能更新与创建

### 更新已有技能

**信号：**
1. **技能指令不完整/不准确** — 按 skill 指导操作但结果不符合预期
2. **脚本执行失败** — skill 引用的脚本有 bug 或过时
3. **AI 绕过了 skill** — skill 不好用，自行写替代命令/脚本
4. **技能缺少功能** — 想用 skill 解决某问题但缺少所需功能，导致写临时脚本

**操作方法：**
- 找到对应 skill 的目录（`skills/<name>/` 或 `.agents/skills/<name>/`）
- 修改 SKILL.md 修复指令、补充步骤、或记录缺失功能
- 如果 skill 包含脚本，修改或扩展脚本
- **修改前让用户确认变更内容**

### 创建新技能

**信号：**
- 对话中解决了一个可复用的通用问题
- 发现了跨项目通用的技术方案或工作流
- 你识别出重复出现的模式

**操作方法：**
1. 向用户说明为什么这值得成为一个 skill
2. **用户确认后才创建**
3. 参照 `writing-skills` 的规范创建（SKILL.md 结构、TDD 流程）

## 附录：各 Agent 指令文件加载机制（写错位置=白写）

### dsh（DeepSeek Harness）

- **用户全局（所有会话、所有项目）**：`$DSH_HOME/AGENTS.md`（默认 `~/.dsh/AGENTS.md`），**文件名固定为 AGENTS.md**
- **项目级**：从项目根到会话 cwd 的**每一级目录**都检查候选文件 `AGENTS.md`、`CLAUDE.md`、`AGENTS.local.md`、`CLAUDE.local.md`（同目录多个候选按此顺序，内容去重后按优先级渲染）
- **项目根判定**：从 cwd 向上找第一个包含 `.git` 的目录

### pi

- 用户级：`~/.pi/agent/AGENTS.md`

### Claude Code

- 用户级：`~/.claude/CLAUDE.md`

## 常见错误

- **不要修改与对话无关的代码** — 只更新对话中直接涉及的 skill
- **不要创建一次性 skill** — 只把可复用的模式封装为 skill
- **不要在项目规则文件中写入全局约定** — 区分清楚作用域
- **不要在用户确认前直接修改文件** — 每类变更列出建议后等用户批准
- **不要过度推断偏好** — 一次行为不是偏好，多次重复才是
