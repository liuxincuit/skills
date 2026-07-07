---
name: supermap-scrum
description: 操作 Supermap Scrum 系统（scrum.supermap.work），支持搜索活动日志、读取任务详情、生成工作报告。可搜索指定时间范围的看板操作记录和任务列表，读取单个 ISVS 任务的完整信息，整合 Scrum 和 Jira 数据生成工作报告。
---

# Supermap Scrum 操作技能

操作 Supermap Scrum 系统（scrum.supermap.work），涵盖搜索、读取、报告生成三大功能。

---

## 搜索 Scrum 活动

搜索指定时间范围内的 Scrum 活动日志和任务列表。

### 前置要求

需要设置 `SUPERMAP_SCRUM_TOKEN` 环境变量：

```bash
export SUPERMAP_SCRUM_TOKEN='your-scrum-token-here'
```

### 使用方法

```bash
node scripts/search_activity.js [选项]
```

### 示例

```bash
# 默认最近7天（过滤处理中/已完成/已验收）
node scripts/search_activity.js

# 指定时间范围
node scripts/search_activity.js --since 2026-03-01 --until 2026-06-29

# 只看处理中的任务
node scripts/search_activity.js --status "处理中"

# 指定用户
node scripts/search_activity.js --since 2026-03-01 --user liuxin1
```

### 参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--since` | 开始日期 (yyyy-MM-dd) | 7天前 |
| `--until` | 结束日期 (yyyy-MM-dd) | 今天 |
| `--status` | 状态过滤，多个用逗号分隔 | `处理中,已完成,已验收` |
| `--user` | 用户名 | `liuxin1` |
| `--json` | 以 JSON 格式输出结构化数据 | 无 |

### 输出说明

脚本输出分三部分：

#### 1. 活动时间线
按日期分组显示看板操作记录（状态变更、负责人变更、Sprint 变更等）。

#### 2. 任务列表
每个任务的完整详情：key、标题、状态、优先级、解决结果、Sprint、关联 Jira 缺陷链接、最近评论摘要。

#### 3. 统计
任务总数、状态分布、关联缺陷比例。

---

## 读取 Scrum 任务详情

读取单个 ISVS 任务的详细信息。

### 使用方式

```bash
node scripts/read_task.js <ISVS Key>
```

示例：
```bash
node scripts/read_task.js ISVS-1165
```

### 参数

- `ISVS Key`: Scrum 任务 key，例如 `ISVS-1165`
- `--json`: 以 JSON 格式输出结构化数据（供其他工具调用）

### 输出信息

- 基本信息（key、标题、状态、优先级、解决结果、负责人、报告人）
- Sprint 信息
- **关联的 Jira 缺陷**（通过 remoteIssueLink 自动获取）
- 描述（description 字段）
- **注释列表**（Comments）

---

## 生成工作报告

整合 Scrum 活动记录 + Jira 问题详情，生成综合工作报告。

### 前置要求

需要设置以下环境变量：
- `SUPERMAP_SCRUM_TOKEN`: Scrum API 认证令牌
- `SUPERMAP_JIRA_TOKEN`: Jira API 认证令牌

### 依赖脚本

本技能依赖以下脚本，`generate_report.js` 在执行时会自动检查它们是否存在：

- `supermap-scrum/scripts/search_activity.js`
- `supermap-jira/scripts/read_jira.js`

如果依赖脚本缺失，会提示用户先安装或创建对应的 skill。

### 使用方法

```bash
node scripts/generate_report.js [选项]
```

### 示例

```bash
# 默认最近7天
node scripts/generate_report.js

# 指定时间范围
node scripts/generate_report.js --since 2026-06-01 --until 2026-06-29

# 指定状态过滤
node scripts/generate_report.js --status "处理中,已完成"

# 指定输出路径
node scripts/generate_report.js --since 2026-06-01 --until 2026-06-29 --output ./weekly.md

# 指定用户
node scripts/generate_report.js --since 2026-06-01 --user liuxin1
```

### 参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--since` | 开始日期 (yyyy-MM-dd) | 7天前 |
| `--until` | 结束日期 (yyyy-MM-dd) | 今天 |
| `--status` | 任务状态过滤，多个用逗号分隔 | `处理中,已完成,已验收` |
| `--user` | 用户名 | `liuxin1` |
| `--output` | 输出文件路径 | 当前目录 `scrum-report_<since>_<until>.md` |

### 输出结构

生成的 Markdown 报告包含：
- 按状态分组的任务列表（已验收/已完成/处理中）
- 每个任务的 Scrum 基本信息和活动时间线
- 关联 Jira 问题的完整详情（描述、缺陷详情、备注）

---

## 通用信息

### 环境变量

- `SUPERMAP_SCRUM_TOKEN`（必需）：Scrum API 认证令牌
- `SUPERMAP_JIRA_TOKEN`（report 必需）：Jira API 认证令牌

### 可用状态

系统支持以下 4 种 Scrum 任务状态：
- `未开始` — 待处理
- `处理中` — 正在处理
- `已完成` — 开发完成
- `已验收` — 已验收通过

### 错误处理

| 场景 | 处理方式 |
|------|----------|
| Token 未设置 | 提示用户设置环境变量 |
| 无效 ISVS Key | 提示 key 格式不正确 |
| 网络错误或认证失败 | 显示对应的错误信息 |
| 依赖脚本缺失 | 提示缺少对应脚本，建议安装 skill |
| 部分 Jira 读取失败 | 跳过该 Jira 详情，保留 Scrum 基本信息 |

### 技术细节

- **认证方式**: Bearer Token
- **依赖**: Node.js 内置模块（https），无需安装额外依赖
