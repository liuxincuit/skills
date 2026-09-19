# AI Agent Skills

AI Agent 插件与 Skills 集合，用于个人开发工作流。

支持 [pi](https://github.com/earendil-works/pi-coding-agent) 和 Claude Code 两种 Agent 环境。

## 快速开始

```bash
# 克隆仓库
git clone git@github.com:liuxincuit/skills.git ~/code/skills
cd ~/code/skills

# 安装社区技能（按 skills-lock.json 恢复）
npx skills experimental_install -y
```

### 集成方式

#### pi

编辑 `~/.pi/agent/settings.json`，修改 `packages`

```json
{
  "packages": [
    "path/skills"
  ]
}
```

将仓库路径添加到 pi 的配置中即可加载所有技能和插件。

## 目录结构

```
├─.agents
│  └─skills              # 社区 skill（由 npx skills 安装）
├─.claude-plugin          # Claude Code 插件配置
├─agents                  # 代理定义
├─hooks                   # Claude Code hooks 配置
├─pi
│  └─extensions           # pi 插件扩展（每个扩展一个子目录）
├─docs                    # 参考文档
├─skills                  # 个人 skill
├─skills-lock.json        # 社区 skill 锁文件
├─package.json            # pi 插件配置
└─AGENTS.md               # 仓库说明（项目指令）
```

skill 分为两种类型：

- **个人技能**：放在 `./skills` 目录下，由我创建和维护
- **社区技能**：来自网络，使用 `npx skills` 管理，安装在 `./.agents/skills`

## 插件

### pi Extensions

`pi/extensions/` 下每个扩展占一个子目录，入口固定为 `index.ts`，配置项、命令、事件挂载点与已知坑见各自的 `README.md`：

| 扩展 | 说明 |
|---|---|
| [`ask-user-question`](pi/extensions/ask-user-question/README.md) | 让模型把选择题交给用户，而不是自己猜 |
| [`auto-prepend`](pi/extensions/auto-prepend/README.md) | 每 N 轮自动注入自定义消息 |
| [`bash-approver`](pi/extensions/bash-approver/README.md) | 自动批准 pi-permission-system 的 bash 命令询问 |
| [`compact-tools`](pi/extensions/compact-tools/README.md) | 内置工具紧凑 TUI 渲染；bash 默认 120s 超时与 .env 环境注入 |
| [`fix-nul-redirect`](pi/extensions/fix-nul-redirect/README.md) | bash 命令中 `> nul` 重定向替换为 `> /dev/null` |
| [`inject-model-name`](pi/extensions/inject-model-name/README.md) | 系统提示注入当前模型名称 |
| [`model-profiles`](pi/extensions/model-profiles/README.md) | `/profile` 档案切换 |
| [`next-phase`](pi/extensions/next-phase/README.md) | 阶段完成后把下一步交接给同树新分支的干净上下文（默认禁用） |
| [`notify-on-reply`](pi/extensions/notify-on-reply/README.md) | Windows 收到回复时系统通知 |
| [`persistent-history`](pi/extensions/persistent-history/README.md) | 跨 `/reload`、`/new` 和新会话保留输入历史 |
| [`rules-context`](pi/extensions/rules-context/README.md) | 路径规则注入（pi-rules 单文件精简版） |
| [`subdir-context`](pi/extensions/subdir-context/README.md) | 按 cwd 自动加载子目录 AGENTS/CLAUDE 上下文 |
| [`tree-summaries`](pi/extensions/tree-summaries/README.md) | 方案文件自动变成 `/tree:<name>`，总结对话并回到会话树开头 |

## 参考

- [skills.sh](https://skills.sh) - Skills 生态官网
- [pi coding agent](https://github.com/earendil-works/pi-coding-agent) - pi Agent 文档
- [Claude Code Hooks](https://code.claude.com/docs/en/hooks) - Claude Code hooks 文档
