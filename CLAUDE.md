## 仓库概述

这个一个 AI Agent 相关的插件仓库，包含 AI Agent 所需的 skills，以及对应的插件，用于个人开发使用


skill 分为两种类型

+ 由这个仓库提供的 skill，放在 `./skills` 目录下
+ 从其他地方获取的 skill，使用 `skills.sh` 进行管理，使用 `skills-lock.json` 

## 技能

### 社区技能

这类技能来自网络，使用 `npx skills` 进行下载，管理，安装之后会在 `skills-lock.json` 中记录。

使用命令 `npx skills experimental_install -y` 会按照 `skills-lock.json` 安装最新技能，安装路径为 `./.agents/skills`

### 个人技能

由我创建的 skill，放在 `./skills` 目录下

## 目录结构

每个技能遵循以下目录布局：

```
├─.agents
│  ├─skills          # 存放社区 skill
├─skills-lock.json   # 由 skills.sh 管理的，通过 `npx skills` 安装恢复的社区 skill 文件
├─.claude-plugin     # claude code 的插件目录
├─hooks              # claude code hooks 配置
├─pi
│  │─extensions      # pi 相关的插件配置
│  └─workflow        # pi 插件 quintinshaw/pi-dynamic-workflows 可使用的工作流
├─package.json       # 部分 AI Agent 的插件文件，比如 pi
└─skills             # 个人 skill
```

## 项目约定（由 retrospective 管理）

- pi 扩展必须放在 `pi/extensions/`（无点前缀），经 `package.json` 的 `pi.extensions` 声明加载（settings.json 的 `packages` 含本仓库）；`.pi/extensions/` 不是插件目录
- `.pi/`（input-history 输入历史）与 `.claude/hooks/`（hooks 运行状态）是运行时数据，不提交到仓库
- 仓库无 `node_modules`：验证 pi 扩展代码用临时目录安装 `@earendil-works/pi-coding-agent` 后 esbuild bundle（`--external:@earendil-works/*`）运行，import 扩展文件用绝对路径（详见 pi-extension-dev 技能）

## 重要注意事项

- 技能之间相互独立，技能之间不共享依赖
- ***工作流一般依赖技能，技能名称更新需要同步检查工作流***
- 脚本需自行处理错误情况和输出格式化
- 更新技能时需保持向后兼容，或记录破坏性变更
- 切勿将 API Token 或凭证提交到代码仓库
