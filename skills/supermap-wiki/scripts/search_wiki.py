#!/usr/bin/env python3
"""
Supermap Wiki Search Script

Searches the Supermap Confluence wiki and returns results as a markdown table.
Uses only Python standard library for cross-platform compatibility.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


def get_token():
    """Get the wiki token from environment variable."""
    token = os.environ.get('SUPERMAP_WIKI_TOKEN')
    if not token:
        print("Error: SUPERMAP_WIKI_TOKEN environment variable is not set.", file=sys.stderr)
        print("Please set it using:", file=sys.stderr)
        print("  Linux/macOS: export SUPERMAP_WIKI_TOKEN='your-token'", file=sys.stderr)
        print("  Windows (cmd): set SUPERMAP_WIKI_TOKEN=your-token", file=sys.stderr)
        print("  Windows (PowerShell): $env:SUPERMAP_WIKI_TOKEN='your-token'", file=sys.stderr)
        sys.exit(1)
    return token


def build_search_url(query, start=0, limit=20):
    """Build the search API URL with query parameters."""
    base_url = "https://wiki.ispeco.com/rest/api/search"

    # Build CQL query
    cql = f'siteSearch ~ "{query}" AND type in ("space","user","com.atlassian.confluence.extra.team-calendars:calendar-content-type","attachment","page","com.atlassian.confluence.extra.team-calendars:space-calendars-view-content-type","blogpost")'

    params = {
        'cql': cql,
        'start': start,
        'limit': limit,
        'excerpt': 'highlight',
        'expand': 'space.icon',
        'includeArchivedSpaces': 'false'
    }

    # URL encode parameters
    encoded_params = urllib.parse.urlencode(params)
    return f"{base_url}?{encoded_params}"


def search_wiki(query, token, limit=20):
    """Perform the wiki search and return results."""
    url = build_search_url(query, limit=limit)

    # Create request with headers
    req = urllib.request.Request(url)
    req.add_header('Authorization', f'Bearer {token}')
    req.add_header('Accept', 'application/json')

    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            data = json.loads(response.read().decode('utf-8'))
            return data
    except urllib.error.HTTPError as e:
        if e.code == 401:
            print("Error: Authentication failed. Please check your SUPERMAP_WIKI_TOKEN.", file=sys.stderr)
        elif e.code == 403:
            print("Error: Access forbidden. You may not have permission to search the wiki.", file=sys.stderr)
        else:
            print(f"Error: HTTP {e.code} - {e.reason}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"Error: Network error - {e.reason}", file=sys.stderr)
        print("Please check your network connection.", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"Error: Failed to parse response - {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: Unexpected error - {e}", file=sys.stderr)
        sys.exit(1)


def format_as_markdown(results):
    """Format search results as a markdown table."""
    if not results:
        print("No results found.")
        return

    # Table header
    print("| Title | Space | Excerpt |")
    print("|-------|-------|---------|")

    # Table rows
    for result in results:
        content = result.get('content', {})
        title = content.get('title', 'N/A')

        # Get space name
        container = result.get('resultGlobalContainer', {})
        space = container.get('title', 'N/A')

        # Get excerpt and clean it up
        excerpt = result.get('excerpt', '')
        # Remove HTML tags and clean whitespace
        excerpt = excerpt.replace('<span class="search-highlight">', '**')
        excerpt = excerpt.replace('</span>', '**')
        excerpt = excerpt.replace('\n', ' ').strip()
        # Truncate long excerpts
        if len(excerpt) > 150:
            excerpt = excerpt[:147] + '...'

        # Build link
        webui_link = content.get('_links', {}).get('webui', '')
        if webui_link:
            link = f"https://wiki.ispeco.com{webui_link}"
            title = f"[{title}]({link})"

        # Escape pipe characters in content
        title = title.replace('|', '\\|')
        space = space.replace('|', '\\|')
        excerpt = excerpt.replace('|', '\\|')

        print(f"| {title} | {space} | {excerpt} |")


def main():
    parser = argparse.ArgumentParser(
        description='Search Supermap wiki and display results as a markdown table.'
    )
    parser.add_argument(
        'query',
        help='Search query string'
    )
    parser.add_argument(
        '-l', '--limit',
        type=int,
        default=20,
        help='Maximum number of results (default: 20)'
    )

    args = parser.parse_args()

    # Get token
    token = get_token()

    # Perform search
    data = search_wiki(args.query, token, args.limit)

    # Extract results
    results = data.get('results', [])
    total_size = data.get('totalSize', 0)

    if results:
        format_as_markdown(results)
        if total_size > len(results):
            print(f"\n_Showing {len(results)} of {total_size} results_")
    else:
        print("No results found.")


if __name__ == '__main__':
    main()