---
name: supermap-wiki
description: 完整操作 Supermap Confluence Wiki，支持搜索、读取、写入、标签管理、评论功能。搜索文档查找信息，读取页面内容（含图片、评论、递归引用），创建新页面或更新现有页面（可指定模板），管理页面标签，给页面添加评论。
allowed-tools: Bash
---

# Supermap Wiki 操作技能

完整操作 Supermap Confluence Wiki 系统，涵盖搜索、读取、写入、标签管理、评论功能。

---

## 搜索 Wiki 页面

以 markdown 表格格式搜索并返回结果。

### 工作原理

1. 从 `SUPERMAP_WIKI_TOKEN` 环境变量读取认证 token
2. 调用 `https://wiki.ispeco.com/rest/api/search` API
3. 解析 JSON 响应并格式化为 markdown 表格

### 执行脚本

```bash
node scripts/search_wiki.js "<搜索词>"
```

可选参数：
- `-l, --limit`: 限制返回结果数量（默认 20）
- `--cql`: 将搜索词视为原始 CQL（Confluence Query Language），支持结构化查询

#### 进阶用法：使用 --cql 进行结构化查询

`--cql` 参数允许直接传入 Confluence CQL 语句，实现按创建者、空间、时间、类型等字段过滤。

常用 CQL 示例：

| 用途 | 命令 |
|------|------|
| 查找当前用户创建的页面 | `node scripts/search_wiki.js --cql "creator = currentUser() AND type = page"` |
| 查找指定用户创建的页面 | `node scripts/search_wiki.js --cql "creator = \"wangwu\" AND type = page"` |
| 查找指定空间中的页面 | `node scripts/search_wiki.js --cql "space = PDG AND type = page"` |
| 查找今天修改过的页面 | `node scripts/search_wiki.js --cql "lastModified >= startOfDay() AND type = page"` |
| 查找最近7天的博客 | `node scripts/search_wiki.js --cql "type = blogpost AND created >= last7Days()"` |
| 按标题搜索特定空间 | `node scripts/search_wiki.js --cql "space = \"云产品研发中心\" AND title ~ \"方案\" AND type = page"` |
| 组合条件查找 | `node scripts/search_wiki.js --cql "creator = currentUser() AND space = PDG AND type = page"` |
| 精确搜索 CVE 编号 | `node scripts/search_wiki.js --cql 'text ~ "CVE-2024-6485" AND type = page'` |

注意事项：
- **搜索 CVE 编号必须使用 CQL 的 `text ~` 而非普通搜索**：普通 `siteSearch` 会拆词匹配（如 `CVE-2024-6485` 会匹配出 `CVE-2024-55194` 等大量无关页面），只有 `text ~ "完整编号"` 才能精确命中包含该 CVE 的页面
- CQL 中字符串值用双引号包裹，命令行中转义用 `\"`
- CQL 支持 `currentUser()`、`startOfDay()`、`last7Days()` 等内置函数
- 更多 CQL 参考：[Atlassian CQL 文档](https://developer.atlassian.com/server/confluence/confluence-query-language-cql/)

### 输出格式

| Title | Space | Excerpt |
|-------|-------|---------|
| [文档标题](链接) | 命名空间 | 摘要内容... |

---

## 读取 Wiki 页面

完整读取页面内容、图片、评论，并递归解析引用的其他页面。

### 功能特性

1. **页面内容获取**: 获取完整的页面文字内容并转换为 markdown
2. **图片提取**: 提取页面中实际显示的图片
3. **评论获取**: 获取页面的所有评论（含嵌套回复），树形展示
4. **递归解析**: 自动解析页面中引用的其他 wiki 页面

### 执行脚本

```bash
node scripts/read_wiki.js "<wiki URL 或 pageId>"
```

可选参数：
- `-d, --depth`: 递归解析引用页面的最大深度（默认 3）
- `--max-comment-depth`: 递归获取评论回复的最大深度（默认无限制）
- `--no-comments`: 不获取评论
- `--no-images`: 不提取图片

### 输出格式

```markdown
# {页面标题}

**空间**: {space名称}
**链接**: {wiki URL}

---

## 页面内容

{清理后的 markdown 内容}

## 页面图片

| # | 文件名 | 下载链接 |
|---|--------|----------|
| 1 | xxx.png | https://... |

## 评论 ({数量}条)

### 评论 1
**作者**: xxx
**时间**: xxx
**内容**: xxx

└── 回复 — **作者**: yyy
    **时间**: yyy
    回复内容...

---

## 引用页面

### {引用页面标题}

{递归内容...}
```

---

## 写入 Wiki 页面

创建新页面或修改现有页面。内容通过 **markdown 宏** 写入：markdown 原文直接存放到 Confluence 的 `markdown` 宏（`ac:plain-text-body` CDATA）中，由宏负责渲染，**不再手工转换为 Storage XHTML**，支持完整的 markdown 语法（标题、表格、列表、代码块、引用、链接、图片、行内格式等），避免转换格式出错。

### 功能特性

1. **创建新页面**: 在指定空间创建新 wiki 页面
2. **修改现有页面**: 更新已有页面的内容（标题保持原样）
3. **markdown 宏渲染**: markdown 原文放入 markdown 宏，渲染由宏完成，支持完整 markdown 语法
4. **自动版本管理**: 更新页面时自动递增版本号
5. **指定父页面**: 创建时可通过 `--parent` 指定父页面，将新页面挂在某页面下方

### 执行脚本

```bash
# 创建新页面
node scripts/write_wiki.js create --space <空间> --title <标题> --content <文件路径> [--parent <pageId>]

# 更新现有页面
node scripts/write_wiki.js update --pageId <pageId> --content <文件路径>
```

### 参数说明

**create 命令:**
- `--space`: 空间 key（如 PDC, ~liuxin1）
- `--title`: 页面标题
- `--content`: 内容文件路径（markdown 格式，完整 markdown 语法均支持）
- `--parent`: （可选）父页面 pageId，新页面将创建在该页面下方

**update 命令:**
- `--pageId`: 要更新的页面 ID
- `--content`: 内容文件路径（markdown 格式）

### 技术实现说明

写入时生成如下 storage 格式（与 wiki 上已有 markdown 宏页面一致）：

```xml
<ac:structured-macro ac:name="markdown" ac:schema-version="1" ac:macro-id="{uuid}">
  <ac:parameter ac:name="atlassian-macro-output-type">INLINE</ac:parameter>
  <ac:plain-text-body><![CDATA[{markdown 原文}]]></ac:plain-text-body>
</ac:structured-macro>
```

- markdown 原文原样放入 CDATA，由宏渲染，无需关注 Confluence storage 细节
- 内容中的 `]]>` 序列会自动拆分转义（`]]]]><![CDATA[>`），渲染后还原为原文
- `macro-id` 为自动生成的 UUID

### 输出格式

创建成功:
```
Page created successfully!
Title: {页面标题}
Page ID: {pageId}
Version: 1
Link: https://wiki.ispeco.com/pages/viewpage.action?pageId={pageId}
```

更新成功:
```
Page updated successfully!
Title: {页面标题}
Page ID: {pageId}
Version: {新版本号}
Link: https://wiki.ispeco.com/pages/viewpage.action?pageId={pageId}
```

---

## 管理页面标签

给 wiki 页面添加/移除/查看标签。标签是全局共享元数据，对所有人可见；给页面打标签会改变页面的可见状态，请确认这是预期的操作。

### 执行脚本

```bash
# 列出页面标签
node scripts/manage_label.js list <pageId>

# 给页面添加标签（已存在则跳过，幂等）
node scripts/manage_label.js add <pageId> <标签名>

# 移除页面标签（不存在则提示）
node scripts/manage_label.js remove <pageId> <标签名>
```

### 示例

```bash
node scripts/manage_label.js list 130526896
node scripts/manage_label.js add 130526896 explored
node scripts/manage_label.js remove 130526896 explored
```

### 输出格式

- list: 每行一个标签名；无标签时输出 `(无标签)`
- add: `Label added to page {pageId}: {标签名}`；已存在时提示 Nothing to do
- remove: `Label removed from page {pageId}: {标签名}`；不存在时提示 Nothing to remove

### 错误处理

- 与现有脚本一致：缺 token / 401 / 403 / 404 / 网络错误 / 超时均输出对应提示并以退出码 1 退出

---

## 给页面添加评论

给 wiki 页面添加一条评论。评论对所有人可见，常用于回写处理结果、留痕。

### 执行脚本

```bash
node scripts/add_comment.js <pageId> <评论文本或文件路径>
```

### 示例

```bash
node scripts/add_comment.js 130526896 "任务已完成，详见评论"
node scripts/add_comment.js 130526896 ./result.md
```

### 说明

- 文本参数如果是一个存在的文件路径，则读取文件内容作为评论
- 评论内容自动转义并转换为 Confluence storage 格式（段落换行转 `<p>`）
- 输出: `Comment added to page {pageId} successfully.` 及 `Comment ID: {id}`

### 错误处理

- 与现有脚本一致：缺 token / 401 / 403 / 404 / 网络错误 / 超时均输出对应提示并以退出码 1 退出

---

## 前置条件

必须设置 `SUPERMAP_WIKI_TOKEN` 环境变量：

```bash
# Linux/macOS
export SUPERMAP_WIKI_TOKEN='your-token-here'

# Windows (cmd)
set SUPERMAP_WIKI_TOKEN=your-token-here

# Windows (PowerShell)
$env:SUPERMAP_WIKI_TOKEN='your-token-here'
```

## 错误处理

所有脚本会处理以下错误情况：
1. **缺少 token**: 提示用户设置 `SUPERMAP_WIKI_TOKEN`
2. **认证失败 (401)**: 提示检查 token 是否正确
3. **权限不足 (403)**: 提示用户可能没有访问权限
4. **网络错误**: 提示检查网络连接或 VPN

### 搜索特定错误
- **无结果**: 显示"No results found."

### 读取特定错误
- **页面不存在 (404)**: 提示检查 pageId 或 URL 是否正确

### 写入特定错误
- **空间不存在**: 创建时提示检查空间 key 是否正确
- **父页面不存在 (404)**: 创建时提示检查 `--parent` pageId 是否正确
- **参数错误**: 提示缺少必需参数

## 技术细节

- **API 端点**: `https://wiki.ispeco.com/rest/api/content`
- **搜索 API**: `GET https://wiki.ispeco.com/rest/api/search`
- **认证方式**: Bearer Token
- **写入内容格式**: Confluence Storage XHTML 中的 markdown 宏（`ac:structured-macro ac:name="markdown"`），markdown 原文存放于 `ac:plain-text-body` CDATA，由宏渲染
- **依赖**: Node.js 内置模块（https、fs、path、crypto），无需安装额外依赖
- **跨平台**: 支持 Linux、macOS、Windows

## 变更记录

- **v1.x（markdown 宏改造）**: 写入改为 markdown 宏方式，移除 `--template` 参数与手写 Storage XHTML 转换逻辑（破坏性变更）；`create` 新增 `--parent` 参数支持指定父页面
