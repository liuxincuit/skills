---
name: supermap-scrum-report
description: 整合 Scrum 活动记录和 Jira 问题详情，生成工作报告。汇总指定时间段内的 Scrum 任务活动、关联的 Jira 问题描述和备注，输出为 Markdown 报告文件。
---

# Supermap Scrum 工作报告

生成指定时间范围内 Scrum 活动 + Jira 问题详情的综合工作报告。

## 前置要求

需要设置以下环境变量：
- `SUPERMAP_SCRUM_TOKEN`: Scrum API 认证令牌
- `SUPERMAP_JIRA_TOKEN`: Jira API 认证令牌

## 依赖脚本

本技能依赖以下脚本，`generate_report.js` 在执行时会自动检查它们是否存在：

- `supermap-scrum-search/scripts/search_activity.js`
- `supermap-jira-read/scripts/read_jira.js`

如果依赖脚本缺失，会提示用户先安装或创建对应的 skill。

### 与其他 skill 的关系

```
supermap-scrum-report  generate_report.js
        │
        ├── 调用 ── supermap-scrum-search/scripts/search_activity.js --json
        │              └── 输出 Scrum 任务列表 + 关联 ISVJ 编号
        │
        └── 调用 ── supermap-jira-read/scripts/read_jira.js ISVJ-XXXX --json
                       └── 输出 Jira 问题详情（描述、备注、处理方式等）
```

API 变更只需修改对应的源脚本，本脚本不受影响。

## 使用方法

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

## 参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--since` | 开始日期 (yyyy-MM-dd) | 7天前 |
| `--until` | 结束日期 (yyyy-MM-dd) | 今天 |
| `--status` | 任务状态过滤，多个用逗号分隔 | `处理中,已完成,已验收` |
| `--user` | 用户名 | `liuxin1` |
| `--output` | 输出文件路径 | 当前目录 `scrum-report_<since>_<until>.md` |

## 输出结构

生成的 Markdown 报告包含：

```
# Scrum 工作报告 (<since> ~ <until>)
> 用户: <user>

## ✔️ 已验收
每个任务包含：
  - Scrum 基本信息（状态、Sprint、解决结果）
  - 活动时间线（状态变更记录）
  - 关联 Jira 问题的完整详情
    - 描述
    - 缺陷详情（重现步骤、详细描述、测试环境）
    - 所有备注（评论）

## 🔄 已完成
...

## 🏗️ 处理中
...
```

## 环境变量

- `SUPERMAP_SCRUM_TOKEN`（必需）：Scrum 系统 API 认证令牌
- `SUPERMAP_JIRA_TOKEN`（必需）：Jira 系统 API 认证令牌

## 错误处理

- 依赖脚本不存在：提示用户创建对应的 skill
- Token 未设置：提示用户设置环境变量
- API 调用失败：输出错误信息并继续处理剩余任务
- 部分 Jira 读取失败：跳过该 Jira 详情，保留 Scrum 基本信息
