#!/usr/bin/env python3
"""
iServer Wiki Search API Client

用法:
    from query_iserver_wiki import query_iserver_wiki

    result = query_iserver_wiki("WMS GetMap")
    print(result)

环境变量:
    ISERVER_WIKI_API_URL  默认 http://localhost:8000
"""

import os
import sys
import requests
from typing import List, Optional

API_URL = os.getenv("ISERVER_WIKI_API_URL", "http://localhost:8000").rstrip("/")


def search(
    keywords: List[str],
    source: str = "all",
    max_results: int = 5,
    context_lines: int = 3,
    full: bool = False,
    timeout: int = 10,
) -> Optional[dict]:
    """
    向 iServer Wiki Search API 发起搜索请求。

    Args:
        keywords: 搜索关键词列表
        source: "raw" | "wiki" | "all"（默认 "all"）
        max_results: 最大结果数（默认 5）
        context_lines: 上下文行数（默认 3）
        full: 是否返回完整内容（默认 False）
        timeout: 请求超时秒数（默认 10）

    Returns:
        JSON dict: {"total": int, "query": str, "results": [...]}
        None: 请求失败
    """
    url = f"{API_URL}/search"
    payload = {
        "keywords": keywords,
        "source": source,
        "max_results": max_results,
        "context_lines": context_lines,
        "full": full,
    }

    try:
        resp = requests.post(url, json=payload, timeout=timeout)
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.ConnectionError:
        print(f"[iserver-wiki] 无法连接到 API 服务: {url}", file=sys.stderr)
        return None
    except requests.exceptions.Timeout:
        print(f"[iserver-wiki] 请求超时", file=sys.stderr)
        return None
    except requests.exceptions.RequestException as e:
        print(f"[iserver-wiki] 请求失败: {e}", file=sys.stderr)
        return None


def format_results(data: dict, include_snippets: bool = True) -> str:
    """
    将 API 返回的 JSON 格式化为适合 LLM 读取的文本。

    Args:
        data: search() 返回的 JSON dict
        include_snippets: 是否包含代码片段（默认 True）

    Returns:
        格式化字符串
    """
    if not data or data.get("total", 0) == 0:
        return "未在 iServer 帮助文档中找到相关结果。"

    total = data["total"]
    query = data["query"]

    lines = [f"根据 iServer 帮助文档搜索 \"{query}\"，找到 {total} 条结果：\n"]

    for i, r in enumerate(data["results"], 1):
        lines.append(f"[{i}] **{r['title']}**")
        lines.append(f"    来源: {r['source']}/{r['file_path']}")
        lines.append(f"    匹配度: {r['score']}")

        if include_snippets and r.get("snippets"):
            lines.append("    相关片段:")
            for snippet in r["snippets"][:3]:  # 最多 3 个片段
                lines.append(f"```")
                for line in snippet.split("\n"):
                    lines.append(f"    {line}")
                lines.append(f"```")

        lines.append("")

    return "\n".join(lines)


def query_iserver_wiki(
    question: str,
    max_results: int = 5,
    source: str = "all",
) -> str:
    """
    一站式查询接口：关键词搜索 + 格式化输出。

    Args:
        question: 用户问题或搜索关键词（空格分隔）
        max_results: 最大结果数
        source: 搜索范围

    Returns:
        格式化后的答案文本
    """
    keywords = question.split()
    data = search(keywords, source=source, max_results=max_results)
    return format_results(data) if data else "查询失败，请检查 iServer Wiki Search API 服务是否正常运行。"


def health_check(timeout: int = 5) -> bool:
    """
    检查 API 服务是否可用。

    Returns:
        True 表示服务正常
    """
    try:
        resp = requests.get(f"{API_URL}/health", timeout=timeout)
        return resp.status_code == 200 and resp.json().get("status") == "ok"
    except Exception:
        return False


if __name__ == "__main__":
    # CLI 用法: python query_iserver_wiki.py "WMS GetMap"
    import argparse

    parser = argparse.ArgumentParser(description="iServer Wiki Search API Client")
    parser.add_argument("query", help="搜索关键词（空格分隔）")
    parser.add_argument("--max-results", type=int, default=5, help="最大结果数")
    parser.add_argument("--source", default="all", choices=["raw", "wiki", "all"], help="搜索范围")
    parser.add_argument("--health", action="store_true", help="检查服务健康状态")

    args = parser.parse_args()

    if args.health:
        ok = health_check()
        print(f"服务状态: {'OK' if ok else '不可用'}")
        sys.exit(0 if ok else 1)

    result = query_iserver_wiki(args.query, max_results=args.max_results, source=args.source)
    print(result)
