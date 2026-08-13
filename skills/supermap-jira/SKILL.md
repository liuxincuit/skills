---
name: supermap-jira
description: 搜索和读取 Supermap Jira 系统中的问题，支持标签管理与添加评论。支持按关键词或 JQL 搜索，读取单个 issue 的完整详情（含自定义缺陷字段、评论、附件），可以 JSON 格式输出供其他工具调用；可给 issue 添加/移除标签、列出系统全部标签、添加评论。
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

**注意**：普通搜索只匹配标题（summary）和描述（description）字段，**搜不到 issue key**。已知 issue key（如 ISVJ-11971）时，直接使用 `node scripts/read_jira.js <KEY>` 读取详情，或使用高级搜索 `--jql 'key = "ISVJ-11971"'`。

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
- 附件列表（含**下载 URL**）

### 下载附件

读取 Issue 详情时，附件会输出下载 URL。也可以直接下载附件到本地：

```bash
# 下载全部附件到当前目录
node scripts/read_jira.js ISVJ-11102 --download

# 按文件名关键字过滤下载（如只下载截图）
node scripts/read_jira.js ISVJ-11102 --download "截图"

# 指定保存目录（不存在会自动创建）
node scripts/read_jira.js ISVJ-11102 --download --download-dir ./attachments
```

`--json` 模式下 `attachments` 数组的 `content` 字段为附件下载 URL，可配合脚本进一步处理。

**注意**：Supermap Jira 使用自定义字段存储缺陷详情：
- `customfield_10040`: 缺陷重现步骤
- `customfield_10043`: 缺陷详细信息描述
- `customfield_10042`: 测试软件环境

---

## 标签管理

给 issue 添加/移除标签，或列出系统中所有标签。

### 使用方法

```bash
# 列出系统中所有标签（按使用频率降序，末尾显示总数）
node scripts/manage_labels.js --list

# 给 issue 添加标签（追加式，保留已有标签）
node scripts/manage_labels.js --add <Jira URL 或 Issue Key> <标签名>

# 从 issue 移除标签
node scripts/manage_labels.js --remove <Jira URL 或 Issue Key> <标签名>
```

示例：

```bash
node scripts/manage_labels.js --list
node scripts/manage_labels.js --add ISVJ-7734 explored
node scripts/manage_labels.js --remove "https://jira.supermap.work/browse/ISVJ-7734" explored
```

**注意**：添加标签是**追加式**操作，不会覆盖或清空 issue 上已有的标签（如迭代标签 `2026M8-2`）。重复添加已存在的标签、移除不存在的标签均为幂等操作，脚本会给出提示而不报错。

---

## 添加评论

给指定 issue 添加一条公开评论（与页面输入一致，无可见性限制）。

### 使用方法

```bash
node scripts/add_comment.js <Jira URL 或 Issue Key> "<评论内容>"
```

示例：

```bash
node scripts/add_comment.js ISVJ-7734 "已分析完成，结论: ..."
```

多段内容传入会被空格拼接为一条评论；换行可在引号内直接输入。成功后输出评论 ID 和 issue 链接，可通过 `read_jira.js` 读取验证。

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
| issue 不存在或无权访问 | 提示 issue 不存在（HTTP 404） |
| 添加已存在的标签 | 幂等提示"标签已存在，无需重复添加" |
| 移除不存在的标签 | 幂等提示"标签不存在，无需移除" |

### 技术细节

- **API 端点**: `https://jira.supermap.work/rest/api/2/search`（搜索）、`/rest/api/2/issue/{key}`（详情、标签更新 PUT）、`/rest/api/2/issue/{key}/comment`（评论 POST）、`/rest/api/2/search` 分页聚合（列出全部标签；Jira Server 无 `/rest/api/2/labels` 端点）
- **认证方式**: Bearer Token
- **依赖**: Node.js 内置模块（https），无需安装额外依赖
- **跨平台**: 支持 Windows、macOS、Linux
