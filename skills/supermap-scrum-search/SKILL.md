---
name: supermap-scrum-search
description: 搜索 Supermap Scrum 系统（scrum.supermap.work）中指定时间范围内的 Scrum 活动日志和任务列表。当用户需要查看自己的 Scrum 活动记录、Sprint 任务列表、ISVS 任务追踪、周报/月报汇总时使用。支持按时间段和状态过滤，输出包含看板操作时间线和任务详情。
---

# Supermap Scrum 搜索技能

搜索 Supermap Scrum 系统（scrum.supermap.work）中指定时间范围内的 Scrum 活动日志，输出看板操作记录和任务详情列表。

## 前置要求

需要设置 `SUPERMAP_SCRUM_TOKEN` 环境变量：

```bash
export SUPERMAP_SCRUM_TOKEN='your-scrum-token-here'
```

## 使用方法

### 直接运行脚本

```bash
node scripts/search_activity.js [选项]
```

### 示例

```bash
# 默认最近7天（过滤处理中/已完成/已验收）
node scripts/search_activity.js

# 指定时间范围
node scripts/search_activity.js --since 2026-03-01 --until 2026-06-29

# 只看未开始的任务
node scripts/search_activity.js --since 2026-06-01 --status "未开始"

# 只看处理中的任务
node scripts/search_activity.js --status "处理中"

# 指定用户
node scripts/search_activity.js --since 2026-03-01 --user liuxin1
```

## 参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--since` | 开始日期 (yyyy-MM-dd) | 7天前 |
| `--until` | 结束日期 (yyyy-MM-dd) | 今天 |
| `--status` | 状态过滤，多个用逗号分隔 | `处理中,已完成,已验收` |
| `--user` | 用户名 | `liuxin1` |
| `--json` | 以 JSON 格式输出结构化数据（供其他工具调用） | 无 |

## 输出说明

脚本输出分两部分：

### 1. 活动时间线
按日期分组显示用户在看板上的操作记录，包括：
- 状态变更（未开始 → 处理中 → 已完成 → 已验收）
- 负责人变更
- Sprint 变更
- 解决结果设置

### 2. 任务列表
每个任务的完整详情：
- 任务 key 和标题
- 当前状态
- 优先级
- 解决结果
- Sprint 信息
- 关联的 Jira 缺陷链接（通过 remoteIssueLink 获取）
- 最近一条评论摘要

### 3. 统计
- 任务总数
- 状态分布
- 关联缺陷比例

## 环境变量

- `SUPERMAP_SCRUM_TOKEN`（必需）：Scrum 系统 API 认证令牌

## 可用状态

系统支持以下 4 种 Scrum 任务状态：
- `未开始` — 待处理
- `处理中` — 正在处理
- `已完成` — 开发完成
- `已验收` — 已验收通过

## 技术细节

- **认证方式**: Bearer Token
- **依赖**: Node.js 内置模块（https），无需安装额外依赖
