---
name: supermap-jira-search
description: 搜索 Supermap Jira 查找问题。用于查找 Jira issues、bug 报告或任务
---

# Supermap Jira 搜索技能

搜索 Supermap Jira 系统中的 issues，并以 markdown 表格格式返回结果。

## 前置要求

需要设置 `SUPERMAP_JIRA_TOKEN` 环境变量：

```bash
# Linux/macOS
export SUPERMAP_JIRA_TOKEN='your-jira-token-here'

# Windows (PowerShell)
$env:SUPERMAP_JIRA_TOKEN='your-jira-token-here'

# Windows (Command Prompt)
set SUPERMAP_JIRA_TOKEN=your-jira-token-here
```

## 输出格式

搜索结果以 markdown 表格形式呈现：

| Key | 状态 | 优先级 | 版本 | 标题 |
| --- | --- | --- | --- | --- |
| ISVJ-1234 | 已关闭 | P2 | 12.0.1 | 标题 |

## 执行方式

### 1. 普通搜索（全文搜索摘要和描述）

```bash
node <scripts_dir>/search_jira.js "<搜索词>"
```

示例：

```bash
node scripts/search_jira.js "范围查询"
```

### 2. 高级搜索（直接使用 JQL）

```bash
node <scripts_dir>/search_jira.js --jql "<JQL 查询语句>"
```

示例：

```bash
node scripts/search_jira.js --jql "(summary ~ \"范围查询\" OR summary ~ \"BOUNDS\") AND project = ISVJ ORDER BY created DESC"
```

脚本会：
1. 检查 `SUPERMAP_JIRA_TOKEN` 环境变量
2. 调用 Jira REST API（JQL）进行搜索
3. 将结果格式化为 markdown 表格

## 错误处理

### Token 未设置
如果 `SUPERMAP_JIRA_TOKEN` 未设置，脚本会提示用户设置该环境变量。

### 网络错误
如果无法连接到 Jira 服务器，会显示网络错误信息。

### 认证失败
如果 token 无效或已过期，会提示认证失败。

### 无结果
如果没有找到匹配的 issues，会显示 "No issues found."

## 技术细节

- **API 端点**: `https://jira.supermap.work/rest/api/2/search`（JQL API）
- **认证方式**: Bearer Token
- **依赖**: Node.js 内置模块（https），无需安装额外依赖
- **跨平台**: 支持 Windows、macOS、Linux
- **默认搜索字段**: summary（标题）、description（描述），按创建时间倒序
- **`--jql` 模式**: 支持任意 JQL 查询，可精确限定 project、status、component 等字段