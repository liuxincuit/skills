---
name: supermap-wiki
description: 完整操作 Supermap Confluence Wiki，支持搜索、读取、写入功能。搜索文档查找信息，读取页面内容（含图片、评论、递归引用），创建新页面或更新现有页面（可指定模板）。
allowed-tools: Bash
---

# Supermap Wiki 操作技能

完整操作 Supermap Confluence Wiki 系统，涵盖搜索、读取、写入三大功能。

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

创建新页面或修改现有页面，可指定模板保持样式一致。

### 功能特性

1. **创建新页面**: 在指定空间创建新 wiki 页面
2. **修改现有页面**: 更新已有页面的内容和标题
3. **模板样式保持**: 可指定模板页面，自动将内容转换为模板的 storage 格式
4. **自动版本管理**: 更新页面时自动递增版本号

### 执行脚本

```bash
# 创建新页面
node scripts/write_wiki.js create --space <空间> --title <标题> --content <文件路径> [--template <pageId>]

# 更新现有页面
node scripts/write_wiki.js update --pageId <pageId> --content <文件路径> [--template <pageId>]
```

### 参数说明

**create 命令:**
- `--space`: 空间 key（如 PDC, ~liuxin1）
- `--title`: 页面标题
- `--content`: 内容文件路径（markdown 格式）
- `--template`: （可选）模板页面 pageId

**update 命令:**
- `--pageId`: 要更新的页面 ID
- `--content`: 内容文件路径（markdown 格式）
- `--template`: （可选）模板页面 pageId

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
- **参数错误**: 提示缺少必需参数

## 技术细节

- **API 端点**: `https://wiki.ispeco.com/rest/api/content`
- **搜索 API**: `GET https://wiki.ispeco.com/rest/api/search`
- **认证方式**: Bearer Token
- **内容格式**: Confluence Storage XHTML
- **依赖**: Node.js 内置模块（https、fs、path），无需安装额外依赖
- **跨平台**: 支持 Linux、macOS、Windows
