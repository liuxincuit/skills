---
name: supermap-jira
description: 搜索和读取 Supermap Jira 系统中的问题。支持按关键词或 JQL 搜索，读取单个 issue 的完整详情（含自定义缺陷字段），可以 JSON 格式输出供其他工具调用。
---

# Supermap Jira 操作技能

搜索和读取 Supermap Jira 系统中的问题。

---

## 搜索 Jira

按关键词或 JQL 搜索 Jira issues，以 markdown 表格返回结果。

### 前置要求

需要设置 `SUPERMAP_JIRA_TOKEN` 环境变量：

```bash
# Linux/macOS
export SUPERMAP_JIRA_TOKEN='your-jira-token-here'

# Windows (PowerShell)
$env:SUPERMAP_JIRA_TOKEN='your-jira-token-here'

# Windows (Command Prompt)
set SUPERMAP_JIRA_TOKEN=your-jira-token-here
```

### 输出格式

| Key | 状态 | 优先级 | 版本 | 标题 |
| --- | --- | --- | --- | --- |
| ISVJ-1234 | 已关闭 | P2 | 12.0.1 | 标题 |

### 执行方式

#### 1. 普通搜索（全文搜索摘要和描述）

```bash
node scripts/search_jira.js "<搜索词>"
```

示例：

```bash
node scripts/search_jira.js "范围查询"
```

#### 2. 高级搜索（直接使用 JQL）

```bash
node scripts/search_jira.js --jql "<JQL 查询语句>"
```

示例：

```bash
node scripts/search_jira.js --jql "(summary ~ \"范围查询\" OR summary ~ \"BOUNDS\") AND project = ISVJ ORDER BY created DESC"
```

---

## 读取 Jira 详情

读取单个 Jira issue 的完整详细信息。

### 使用方法

```bash
node scripts/read_jira.js <Jira URL 或 Issue Key>
```

示例：
```bash
node scripts/read_jira.js ISVJ-11474
node scripts/read_jira.js "https://jira.supermap.work/browse/ISVJ-11474"
```

### 参数

- `Jira URL` 或 `Issue Key`: Jira 问题标识
- `--json`: 以 JSON 格式输出结构化数据（供其他工具调用）

### 输出信息

- 基本信息（key、标题、状态、优先级等）
- 报告人和负责人
- 组件和版本
- 描述
- **缺陷详情**（自定义字段：重现步骤、详细描述、测试环境）
- 附件列表

**注意**：Supermap Jira 使用自定义字段存储缺陷详情：
- `customfield_10040`: 缺陷重现步骤
- `customfield_10043`: 缺陷详细信息描述
- `customfield_10042`: 测试软件环境

---

## 通用信息

### 环境变量

- `SUPERMAP_JIRA_TOKEN`（必需）：Jira API 认证令牌

### 错误处理

| 场景 | 处理方式 |
|------|----------|
| Token 未设置 | 提示用户设置 `SUPERMAP_JIRA_TOKEN` |
| 网络错误 | 显示网络错误信息 |
| 认证失败 | 提示 token 无效或已过期 |
| 无搜索结果 | 显示 "No issues found." |

### 技术细节

- **API 端点**: `https://jira.supermap.work/rest/api/2/search`
- **认证方式**: Bearer Token
- **依赖**: Node.js 内置模块（https），无需安装额外依赖
- **跨平台**: 支持 Windows、macOS、Linux
