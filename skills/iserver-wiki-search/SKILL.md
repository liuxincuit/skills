---
name: iserver-wiki-search
description: "查询 SuperMap iServer 帮助文档 Wiki Search API。"
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [iserver, supermap, wiki, search, api, rag, help, documentation]
    related_skills: []
---

# iServer Wiki Search

查询 SuperMap iServer 帮助文档的远程搜索服务，基于 FastAPI 构建。

## 触发条件

当用户的问题涉及 SuperMap iServer 的以下主题时：
- 服务管理（WMS、WMTS、REST 地图服务等）
- 安装配置、HTTPS、集群、安全认证
- API 使用、开发指南
- 故障排查、性能优化
- 任何 iServer 相关的"如何..."操作问题

## API 地址

默认: `http://localhost:8000`

如果环境变量 `ISERVER_WIKI_API_URL` 存在，优先使用。

## 端点

### 1. 健康检查

```
GET /health
```

返回: `{"status": "ok"}` — 服务可用。

### 2. 搜索

```
GET /search?q=<关键词>&source=all&max_results=20&context_lines=3&full=false
```

或 POST（推荐，支持多关键词精确控制）：

```
POST /search
Content-Type: application/json

{
  "keywords": ["WMS", "GetMap"],
  "source": "all",
  "max_results": 10,
  "context_lines": 3,
  "full": false
}
```

**参数说明：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `keywords` | List[str] | 是 | 搜索关键词，至少 1 个 |
| `source` | str | 否 | 搜索范围: `raw`（原始文档）、`wiki`（已整理知识页）、`all`（默认） |
| `max_results` | int | 否 | 最大结果数，默认 20，范围 1-100 |
| `context_lines` | int | 否 | 每个匹配返回的上下文行数，默认 3 |
| `full` | bool | 否 | 是否返回完整文档内容，默认 false（建议保持 false，只读 snippets） |

## 返回值结构

```json
{
  "total": 3,
  "query": "WMS GetMap",
  "results": [
    {
      "source": "raw_md",
      "file_path": "API/WMS/WMS_GetMap.md",
      "score": 270,
      "matched_keywords": ["WMS", "GetMap"],
      "title": "WMS GetMap 接口说明",
      "snippets": [
        "   ...",
        ">>> GetMap 请求支持以下参数：",
        "   width=1024&height=768",
        "   ..."
      ],
      "content": null
    }
  ]
}
```

**重要：AI Agent 应优先使用 `snippets` 构建答案**，而不是 `content`。`snippets` 是关键词出现处的上下文片段，更精确、更少噪音。

## 调用方式

### 直接执行脚本

```bash
# 搜索 iServer 帮助文档
python scripts/query_iserver_wiki.py "WMS GetMap"

# 指定结果数
python scripts/query_iserver_wiki.py "HTTPS 配置" --max-results 3

# 只搜索 wiki 页面
python scripts/query_iserver_wiki.py "集群部署" --source wiki

# 检查服务健康状态
python scripts/query_iserver_wiki.py --health
```

脚本从 stdout 输出格式化后的搜索结果，可直接读取使用。


## 关键原则

1. **优先读 snippets**：`snippets` 是用户问题的直接上下文，比完整文档更精确
2. **标注来源**：回答中应注明信息来自哪个文件路径（`file_path`）
3. **source 选择**：
   - `wiki` 更结构化，信息经过整理，优先选择
   - `raw_md` 是原始文档，信息更完整但更冗长
   - 不确定时用 `all`
4. **中文分词**：如果用户问题很长，建议拆成 2-4 个关键词，避免单次请求包含过多无关词
5. **失败回退**：如果 API 不可用（ConnectionError），应告知用户服务未启动或地址配置错误

## 常见错误

| 错误 | 原因 | 处理 |
|------|------|------|
| `Connection refused` | 服务未启动 | 检查 `ISERVER_WIKI_API_URL` 或确认服务是否运行 |
| `400 Bad Request` | source 参数错误 | 确保 source 是 `raw`、`wiki` 或 `all` |
| `[]` 空结果 | 关键词太生僻 | 尝试同义词或更通用的词 |
| `ModuleNotFoundError` | API server 内部 Python 环境问题 | 这是服务端问题，非客户端问题 |

## 集成到对话中的流程

当用户问 iServer 相关问题时：

1. **提取关键词** — 从问题中提取 2-4 个核心词
2. **调用 API** — 使用 POST /search，max_results=5-10
3. **读取 snippets** — 从返回的 `snippets` 中提取有用信息
4. **合成答案** — 结合 snippets，用自然语言回答用户问题
5. **标注来源** — 在答案末尾注明"来源: [文件路径]"

**示例对话：**

用户: "iServer 怎么配置 HTTPS？"

Agent:
- 提取关键词: `["HTTPS", "配置"]`
- 调用 API → 得到 `wiki/concepts/安全.md` 和 `raw_md/Subject_introduce/Security/https.md`
- 读取 snippets → 找到配置步骤
- 合成答案: "iServer 配置 HTTPS 需要...（步骤）。来源: `wiki/concepts/安全.md`"
