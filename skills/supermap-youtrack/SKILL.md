---
name: supermap-youtrack
description: 搜索 YouTrack 问题和生成 YouTrack 工作报告。支持按关键词搜索 issues，以及获取指定时间范围内的工作时间记录并生成结构化工作总结报告（含父任务分组、工时统计）。
---

# Supermap YouTrack 操作技能

搜索 YouTrack issues 和生成工作报告。

---

## 搜索 YouTrack

搜索 YouTrack issues，以 markdown 表格返回结果。

### 前置要求

需要设置 `SUPERMAP_YOUTRACK_TOKEN` 环境变量：

```bash
# Linux/macOS
export SUPERMAP_YOUTRACK_TOKEN='your-youtrack-token-here'

# Windows (PowerShell)
$env:SUPERMAP_YOUTRACK_TOKEN='your-youtrack-token-here'

# Windows (Command Prompt)
set SUPERMAP_YOUTRACK_TOKEN=your-youtrack-token-here
```

### 输出格式

| 标题 | 链接 |
| --- | --- |
| iManager alpha 出包出镜像&测试包 | http://yt.ispeco.com:8099/issue/CS-4408 |

### 执行方式

```bash
node scripts/search_youtrack.js "<搜索词>"
```

---

## 读取任务详情

读取单个 YouTrack 任务的完整详情，包括自定义字段、描述、备注，以及通过 `trimmedIssues` API 自动查找父缺陷（支持 Subtask 链接类型）。

### 触发条件

- 需要查看某个 YouTrack 任务的完整信息
- 需要找某个任务的父缺陷/父任务
- 需要查父缺陷的备注内容

### 执行方式

```bash
node scripts/read_task.js <issue-key>
```

示例：

```bash
node scripts/read_task.js CS-5412
node scripts/read_task.js CS-5355
```

### 输出信息

- 基本信息（key、标题、项目）
- 自定义字段（优先级、状态、类型、Sprint、解决人、预估工时等）
- 描述内容
- **父缺陷**（通过 trimmedIssues API 自动查找 Subtask INWARD 链接）
- **备注列表**（含作者、时间、完整内容）

---

## 生成工作报告

从 YouTrack 获取工作时间记录并生成结构化工作总结报告。

### 触发条件

当用户表达以下意图时自动调用：
- "总结[时间]的YouTrack工作内容"
- "生成[时间]的工作报告"
- "查看[时间]的工作统计"
- "youtrack总结 [时间]"

### 时间格式支持

- 月份：`2026-01`、`2026年1月`
- 日期范围：`2026-01-01到2026-01-31`
- 相对时间：`本月`、`上个月`、`上周`

### 执行方式

```bash
python3 scripts/youtrack_summary_stdlib.py <时间参数>
```

示例：
```bash
python3 scripts/youtrack_summary_stdlib.py 2026-01
python3 scripts/youtrack_summary_stdlib.py 2026-01-01 2026-02-01
```

### 工作流程

1. **解析时间范围**: 将自然语言时间转换为起止日期
2. **获取工作项数据**: 通过 YouTrack API 获取时间跟踪数据
3. **分析父任务关系**: 通过链接 API 识别每个任务的真实父任务
4. **分组与统计**: 按父任务分组，计算工时、天数、工作项数
5. **生成报告**: 输出结构化工作总结

### 输出结构

报告包含：
- 父任务分组（每个父任务独立显示，含子任务详情）
- 其他任务分组（无父任务的任务）
- 总体汇总（子任务数、工作项数、总工时、工作天数）
- 各父任务工时分布（含占比）

### 配置要求

```bash
# 必需
export SUPERMAP_YOUTRACK_TOKEN="your-token-here"

# 可选（默认 http://yt.ispeco.com:8099）
export YOUTRACK_URL="http://yt.ispeco.com:8099"
```

### 边界情况处理

| 场景 | 处理方式 |
|------|----------|
| 无工作记录 | 提示"指定时间范围内无工作记录" |
| 多个父任务 | 每个父任务独立分组显示 |
| 无父任务的任务 | 归入"其他任务（无父任务）"分组 |
| API 调用失败 | 显示错误信息，建议检查网络和令牌 |

### 依赖工具

- Python 3.7+
- requests 库（可选，stdlib 版本无需额外依赖）

---

## 通用信息

### 环境变量

- `SUPERMAP_YOUTRACK_TOKEN`（必需）：YouTrack API 认证令牌
- `YOUTRACK_URL`（可选，默认 `http://yt.ispeco.com:8099`）

### 错误处理

| 场景 | 处理方式 |
|------|----------|
| Token 未设置 | 提示用户设置环境变量 |
| 网络错误 | 显示网络错误信息 |
| 认证失败 | 提示 token 无效或已过期 |
| 无结果 | 显示 "No issues found." 或 "无工作记录" |

### 技术细节

- **地址**: `http://yt.ispeco.com:8099`
- **API**: `GET /api/issues`（搜索）、`GET /api/issues/{key}`（读取详情）、`GET /api/issues/{key}/links?fields=...,trimmedIssues(...)`（查找父缺陷）、`GET /api/workitems`（工时）
- **父缺陷查找方式**: 通过 `/api/issues/{key}/links` 接口，使用 `trimmedIssues` 字段获取关联 issue。当 `direction=INWARD` 且 `sourceToTarget` 包含 "parent for" 时，`trimmedIssues[0]` 即为父缺陷
- **认证方式**: Bearer Token
- **跨平台**: 支持 Windows、macOS、Linux
