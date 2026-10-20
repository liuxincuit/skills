# AI Agent Skills

AI Agent 技能与工作流集合，用于个人开发工作流。

支持 [pi](https://github.com/earendil-works/pi-coding-agent) 和 Claude Code 两种 Agent 环境。

pi 插件已拆到独立仓库 `D:/code/pi-packages`，每个插件一个包。本仓库只保留技能与依赖技能的工作流。

## 快速开始

```bash
git clone git@github.com:liuxincuit/skills.git ~/code/skills
cd ~/code/skills

# 安装社区技能（按 skills-lock.json 恢复）
npx skills experimental_install -y
```

### 集成方式

#### pi

编辑 `~/.pi/agent/settings.json`，把仓库路径加进 `packages`：

```json
{
  "packages": [
    "D:/code/skills"
  ]
}
```

本仓库的 `package.json` 只声明 `skills`，不会加载任何扩展。

## 目录结构

```
├─.agents
│  └─skills              # 社区 skill（由 npx skills 安装）
├─.claude-plugin          # Claude Code 插件配置
├─agents                  # 代理定义
├─hooks                   # Claude Code hooks 配置
├─docs                    # 参考文档
├─skills                  # 个人 skill
├─workflows               # 依赖技能的工作流脚本
├─skills-lock.json        # 社区 skill 锁文件
├─package.json            # pi 配置：只声明 skills
└─AGENTS.md               # 仓库说明（项目指令）
```

skill 分为两种类型：

- **个人技能**：放在 `./skills` 目录下，由我创建和维护
- **社区技能**：来自网络，使用 `npx skills` 管理，安装在 `./.agents/skills`

## 工作流

`workflows/` 下的脚本依赖 `skills/iserver-*` 等技能，不随 pi 包加载，按需手动执行。

## 相关仓库

- `D:/code/pi-packages`：pi 插件集合，每个插件一个独立包

## 参考

- [skills.sh](https://skills.sh) - Skills 生态官网
- [pi coding agent](https://github.com/earendil-works/pi-coding-agent) - pi Agent 文档
- [Claude Code Hooks](https://code.claude.com/docs/en/hooks) - Claude Code hooks 文档
