---
name: supermap-jira-read
description: 读取 Supermap Jira 问题的详情。用于获取单个 Jira issue 的完整信息
---

# Supermap Jira Read

该技能用于读取 Supermap Jira 系统中单个问题的详细信息。

## 使用方法

### 直接运行脚本

```bash
node scripts/read_jira.js <Jira URL 或 Issue Key>
```

示例：
```bash
node scripts/read_jira.js ISVJ-11474
node scripts/read_jira.js "https://jira.supermap.work/browse/ISVJ-11474"
```

## 参数

- `Jira URL`: 完整的 Jira 问题链接，例如 `https://jira.supermap.work/browse/ISVJ-11474`
- `Issue Key`: Jira 问题 key，例如 `ISVJ-11474`
- `--json`: 以 JSON 格式输出结构化数据（供其他工具调用）

## 环境变量

- `SUPERMAP_JIRA_TOKEN`: Jira API 认证令牌

## 输出信息

- 基本信息（key、标题、状态、优先级等）
- 报告人和负责人
- 组件和版本
- 描述（标准描述字段）
- **缺陷详情**（自定义字段：重现步骤、详细描述、测试环境）
- 附件列表

**注意**：Supermap Jira 使用自定义字段存储缺陷详情：
- `customfield_10040`: 缺陷重现步骤
- `customfield_10043`: 缺陷详细信息描述
- `customfield_10042`: 测试软件环境
