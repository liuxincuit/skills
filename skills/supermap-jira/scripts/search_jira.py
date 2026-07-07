#!/usr/bin/env python3
"""
Supermap Jira Search Script

Searches the Supermap Jira system and returns results as a markdown table.
Uses the SUPERMAP_JIRA_TOKEN environment variable for authentication.
"""

import os
import sys
import json
import urllib.request
import urllib.error
import urllib.parse


JIRA_BASE_URL = "https://jira.supermap.work"
API_ENDPOINT = f"{JIRA_BASE_URL}/rest/quicksearch/1.0/productsearch/search"


def get_token():
    """Get the Jira token from environment variable."""
    token = os.environ.get("SUPERMAP_JIRA_TOKEN")
    if not token:
        print("Error: SUPERMAP_JIRA_TOKEN environment variable is not set.", file=sys.stderr)
        print("Please set it with: export SUPERMAP_JIRA_TOKEN='your-token-here'", file=sys.stderr)
        sys.exit(1)
    return token


def search_jira(query, token):
    """
    Search Jira for the given query.

    Args:
        query: Search keyword(s)
        token: Bearer token for authentication

    Returns:
        Parsed JSON response as a dictionary
    """
    encoded_query = urllib.parse.quote(query)
    url = f"{API_ENDPOINT}?q={encoded_query}"

    request = urllib.request.Request(url)
    request.add_header("Authorization", f"Bearer {token}")
    request.add_header("Accept", "application/json")

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = response.read().decode("utf-8")
            return json.loads(data)
    except urllib.error.HTTPError as e:
        if e.code == 401:
            print("Error: Authentication failed. Please check your SUPERMAP_JIRA_TOKEN.", file=sys.stderr)
        elif e.code == 403:
            print("Error: Access forbidden. You may not have permission to search.", file=sys.stderr)
        else:
            print(f"Error: HTTP {e.code} - {e.reason}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"Error: Network error - {e.reason}", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError:
        print("Error: Failed to parse response from Jira.", file=sys.stderr)
        sys.exit(1)


def format_as_markdown_table(items):
    """
    Format the search results as a markdown table.

    Args:
        items: List of issue items with 'title', 'subtitle', and 'url' fields

    Returns:
        Markdown formatted string
    """
    if not items:
        return "No issues found."

    # Table header
    lines = ["| 标题 | 链接 |", "| --- | --- |"]

    # Table rows
    for item in items:
        title = item.get("title", "N/A")
        url = item.get("url", "")

        if url:
            lines.append(f"| {title} | {url} |")
        else:
            lines.append(f"| {title} | N/A |")

    return "\n".join(lines)


def extract_issues(response):
    """
    Extract only the 'quick-search-issues' results from the response.

    Args:
        response: Parsed JSON response

    Returns:
        List of issue items
    """
    if not isinstance(response, list):
        return []

    for section in response:
        if isinstance(section, dict) and section.get("id") == "quick-search-issues":
            return section.get("items", [])

    return []


def print_help():
    """Print help message."""
    help_text = """Supermap Jira Search

Usage: python search_jira.py <search-query>

Description:
    Search the Supermap Jira system and return matching issues as a markdown table.

Environment Variables:
    SUPERMAP_JIRA_TOKEN  - Required. Your Jira API token for authentication.

Examples:
    python search_jira.py iServer
    python search_jira.py "bug fix"
    python search_jira.py --help

Output:
    Results are displayed as a markdown table with issue titles and links.
"""
    print(help_text)


def main():
    """Main entry point."""
    args = sys.argv[1:]

    if not args or args[0] in ["--help", "-h"]:
        print_help()
        sys.exit(0)

    query = " ".join(args)
    token = get_token()

    response = search_jira(query, token)
    issues = extract_issues(response)

    output = format_as_markdown_table(issues)
    print(output)


if __name__ == "__main__":
    main()