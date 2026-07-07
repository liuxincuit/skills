#!/usr/bin/env python3
"""
Supermap YouTrack Search Script

Searches the Supermap YouTrack system and returns results as a markdown table.
Uses the SUPERMAP_YOUTRACK_TOKEN environment variable for authentication.
"""

import os
import sys
import json
import urllib.request
import urllib.error
import urllib.parse


YOUTRACK_BASE_URL = "http://yt.ispeco.com:8099"
API_ENDPOINT = f"{YOUTRACK_BASE_URL}/api/issues"

# Query parameters for the API request
QUERY_PARAMS = {
    "$top": "-1",
    "$skip": "0",
    "fields": "id,idReadable,summary"
}


def get_token():
    """Get the YouTrack token from environment variable."""
    token = os.environ.get("SUPERMAP_YOUTRACK_TOKEN")
    if not token:
        print("Error: SUPERMAP_YOUTRACK_TOKEN environment variable is not set.", file=sys.stderr)
        print("Please set it with: export SUPERMAP_YOUTRACK_TOKEN='your-token-here'", file=sys.stderr)
        sys.exit(1)
    return token


def search_youtrack(query, token):
    """
    Search YouTrack for the given query.

    Args:
        query: Search keyword(s)
        token: Bearer token for authentication

    Returns:
        Parsed JSON response as a list of issues
    """
    # Build URL with query parameters
    params = QUERY_PARAMS.copy()
    params["query"] = query

    encoded_params = urllib.parse.urlencode(params)
    url = f"{API_ENDPOINT}?{encoded_params}"

    request = urllib.request.Request(url)
    request.add_header("Authorization", f"Bearer {token}")
    request.add_header("Accept", "application/json")

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = response.read().decode("utf-8")
            return json.loads(data)
    except urllib.error.HTTPError as e:
        if e.code == 401:
            print("Error: Authentication failed. Please check your SUPERMAP_YOUTRACK_TOKEN.", file=sys.stderr)
        elif e.code == 403:
            print("Error: Access forbidden. You may not have permission to search.", file=sys.stderr)
        else:
            print(f"Error: HTTP {e.code} - {e.reason}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"Error: Network error - {e.reason}", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError:
        print("Error: Failed to parse response from YouTrack.", file=sys.stderr)
        sys.exit(1)


def format_as_markdown_table(issues):
    """
    Format the search results as a markdown table.

    Args:
        issues: List of issue items with 'summary' and 'idReadable' fields

    Returns:
        Markdown formatted string
    """
    if not issues:
        return "No issues found."

    # Table header
    lines = ["| 标题 | 链接 |", "| --- | --- |"]

    # Table rows
    for issue in issues:
        summary = issue.get("summary", "N/A")
        id_readable = issue.get("idReadable", "")

        if id_readable:
            url = f"{YOUTRACK_BASE_URL}/issue/{id_readable}"
            lines.append(f"| {summary} | {url} |")
        else:
            lines.append(f"| {summary} | N/A |")

    return "\n".join(lines)


def print_help():
    """Print help message."""
    help_text = """Supermap YouTrack Search

Usage: python search_youtrack.py <search-query>

Description:
    Search the Supermap YouTrack system and return matching issues as a markdown table.

Environment Variables:
    SUPERMAP_YOUTRACK_TOKEN  - Required. Your YouTrack API token for authentication.

Examples:
    python search_youtrack.py test
    python search_youtrack.py "bug fix"
    python search_youtrack.py CS-4408
    python search_youtrack.py --help

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

    issues = search_youtrack(query, token)
    output = format_as_markdown_table(issues)
    print(output)


if __name__ == "__main__":
    main()