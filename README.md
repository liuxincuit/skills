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
├─hooks                   # Claude Code hooks 配置
├─pi
│  └─extensions           # pi 插件扩展
├─docs                    # 参考文档
├─skills                  # 个人 skill
├─skills-lock.json        # 社区 skill 锁文件
├─package.json            # pi 插件配置
└─CLAUDE.md               # 仓库说明（项目指令）
```

skill 分为两种类型：

- **个人技能**：放在 `./skills` 目录下，由我创建和维护
- **社区技能**：来自网络，使用 `npx skills` 管理，安装在 `./.agents/skills`

## 插件

### pi Extensions

`pi/extensions/` 目录包含 pi 的扩展插件：

- `auto-prepend.ts` - 每 N 轮自动注入自定义消息（配置 `~/.pi/agent/auto-prepend.json`）
- `bash-approver.ts` - 自动批准 pi-permission-system 的 bash 命令询问
- `compact-tools.ts` - 内置工具紧凑 TUI 渲染；bash 默认 120s 超时（LLM 显式 timeout 优先）与 .env 环境注入
- `fix-nul-redirect.ts` - bash 命令中 `> nul` 重定向替换为 `> /dev/null`（Git Bash 兼容）
- `inject-model-name.ts` - 系统提示注入当前模型名称
- `model-profiles.ts` - `/profile` 档案切换（按会话加载/卸载 settings 与 packages）
- `notify-on-reply.ts` - Windows 收到回复时系统通知
- `persistent-history.ts` - 跨 `/reload`、`/new` 和新会话保留输入历史
- `rules-context.ts` - 路径规则注入（pi-rules 单文件精简版）
- `subdir-context.ts` - 按 cwd 自动加载子目录 AGENTS/CLAUDE 上下文

## 参考

- [skills.sh](https://skills.sh) - Skills 生态官网
- [pi coding agent](https://github.com/earendil-works/pi-coding-agent) - pi Agent 文档
- [Claude Code Hooks](https://code.claude.com/docs/en/hooks) - Claude Code hooks 文档
