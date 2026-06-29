---
name: supermap-scrum-read
description: 读取 Supermap Scrum 系统（scrum.supermap.work）中单个 ISVS 任务的详细信息。当用户需要查看 scrum 任务详情、ISVS 任务、Sprint 任务信息时使用，包括标题、优先级、解决结果、描述、关联的 Jira 缺陷链接、注释等。无论用户给出的是 ISVS 编号还是 Scrum 看板的 URL，都应该使用此技能获取任务详情。
---

# Supermap Scrum Read

该技能用于读取 Supermap Scrum 系统（scrum.supermap.work）中单个 ISVS 任务的详细信息。

## 前置要求

需要设置 `SUPERMAP_SCRUM_TOKEN` 环境变量：

```bash
export SUPERMAP_SCRUM_TOKEN='your-scrum-token-here'
```

## 使用方法

### 直接运行脚本

```bash
node scripts/read_task.js <ISVS Key>
```

示例：
```bash
node scripts/read_task.js ISVS-1165
```

## 参数

- `ISVS Key`: Scrum 任务 key，例如 `ISVS-1165`

## 输出信息

- 基本信息（key、标题、状态、优先级、解决结果、负责人、报告人、时间信息）
- Sprint 信息
- **关联的 Jira 缺陷**（通过 remoteIssueLink 自动获取，优先于标题匹配）
- 描述（description 字段）
- **注释列表**（Comments）

## 错误处理

### Token 未设置
如果 `SUPERMAP_SCRUM_TOKEN` 未设置脚本会提示错误。

### 无效 Key
如果提供的 ISVS Key 格式不正确，会提示错误信息。

### 网络错误或认证失败
如果无法连接到 Scrum 服务器或 token 无效/过期，会显示对应的错误信息。

## 技术细节

- **认证方式**: Bearer Token
- **依赖**: Node.js 内置模块（https），无需安装额外依赖
