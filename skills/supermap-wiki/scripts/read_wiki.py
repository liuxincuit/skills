#!/usr/bin/env python3
"""
Supermap Wiki Read Script

Reads a wiki page completely including content, images, comments,
and recursively parses referenced wiki pages.
Uses only Python standard library for cross-platform compatibility.
"""

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser


# Constants
WIKI_BASE_URL = "https://wiki.ispeco.com"
API_BASE_URL = "https://wiki.ispeco.com/rest/api"


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


def parse_page_id(url_or_id):
    """Extract page ID from URL or return the ID directly."""
    # If it's just a number, return it
    if url_or_id.isdigit():
        return url_or_id

    # Try to extract pageId from URL
    parsed = urllib.parse.urlparse(url_or_id)
    query_params = urllib.parse.parse_qs(parsed.query)

    if 'pageId' in query_params:
        return query_params['pageId'][0]

    # Try to extract from path patterns like /display/SPACE/Title or /pages/viewpage.action
    # For now, we only support pageId-based URLs
    print(f"Error: Could not extract pageId from URL: {url_or_id}", file=sys.stderr)
    print("Please use a URL with pageId parameter or provide the pageId directly.", file=sys.stderr)
    sys.exit(1)


def make_api_request(url, token):
    """Make an authenticated API request."""
    req = urllib.request.Request(url)
    req.add_header('Authorization', f'Bearer {token}')
    req.add_header('Accept', 'application/json')

    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        if e.code == 401:
            print("Error: Authentication failed. Please check your SUPERMAP_WIKI_TOKEN.", file=sys.stderr)
        elif e.code == 403:
            print("Error: Access forbidden. You may not have permission to access this page.", file=sys.stderr)
        elif e.code == 404:
            print("Error: Page not found. Please check the pageId or URL.", file=sys.stderr)
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


def get_page_content(page_id, token):
    """Get the page content from the API."""
    url = f"{API_BASE_URL}/content/{page_id}?expand=body.storage,space,version,history"
    return make_api_request(url, token)


def get_comments(page_id, token):
    """Get comments for a page."""
    url = f"{API_BASE_URL}/content/{page_id}/child/comment?expand=body.storage,history&limit=100"
    try:
        return make_api_request(url, token)
    except SystemExit:
        # If comments fail, return empty results instead of exiting
        return {'results': []}


class HTMLToMarkdown(HTMLParser):
    """Simple HTML to Markdown converter."""

    def __init__(self):
        super().__init__()
        self.result = []
        self.current_tag = None
        self.list_depth = 0
        self.list_type = None
        self.ignore_tags = {'script', 'style', 'head'}
        self.in_pre = False
        self.in_code = False

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        self.current_tag = tag

        if tag in self.ignore_tags:
            return

        attrs_dict = dict(attrs)

        if tag == 'h1':
            self.result.append('\n# ')
        elif tag == 'h2':
            self.result.append('\n## ')
        elif tag == 'h3':
            self.result.append('\n### ')
        elif tag == 'h4':
            self.result.append('\n#### ')
        elif tag == 'h5':
            self.result.append('\n##### ')
        elif tag == 'h6':
            self.result.append('\n###### ')
        elif tag == 'p':
            self.result.append('\n\n')
        elif tag == 'br':
            self.result.append('  \n')
        elif tag == 'hr':
            self.result.append('\n---\n')
        elif tag == 'strong' or tag == 'b':
            self.result.append('**')
        elif tag == 'em' or tag == 'i':
            self.result.append('*')
        elif tag == 'code':
            self.result.append('`')
            self.in_code = True
        elif tag == 'pre':
            self.result.append('\n```\n')
            self.in_pre = True
        elif tag == 'blockquote':
            self.result.append('\n> ')
        elif tag == 'a':
            href = attrs_dict.get('href', '')
            self.result.append(f'[')
            self.current_attrs = {'href': href}
        elif tag == 'img':
            src = attrs_dict.get('src', '')
            alt = attrs_dict.get('alt', 'image')
            self.result.append(f'![{alt}]({src})')
        elif tag == 'ul':
            self.list_type = 'ul'
            self.list_depth += 1
            self.result.append('\n')
        elif tag == 'ol':
            self.list_type = 'ol'
            self.list_depth += 1
            self.result.append('\n')
        elif tag == 'li':
            self.result.append('\n')
            indent = '  ' * (self.list_depth - 1)
            if self.list_type == 'ol':
                self.result.append(f'{indent}1. ')
            else:
                self.result.append(f'{indent}- ')
        elif tag == 'table':
            self.result.append('\n')
        elif tag == 'tr':
            self.result.append('|')
        elif tag == 'th' or tag == 'td':
            self.result.append(' ')

    def handle_endtag(self, tag):
        tag = tag.lower()

        if tag in self.ignore_tags:
            return

        if tag == 'h1' or tag == 'h2' or tag == 'h3' or tag == 'h4' or tag == 'h5' or tag == 'h6':
            self.result.append('\n')
        elif tag == 'p':
            self.result.append('\n')
        elif tag == 'strong' or tag == 'b':
            self.result.append('**')
        elif tag == 'em' or tag == 'i':
            self.result.append('*')
        elif tag == 'code':
            self.result.append('`')
            self.in_code = False
        elif tag == 'pre':
            self.result.append('\n```\n')
            self.in_pre = False
        elif tag == 'blockquote':
            self.result.append('\n')
        elif tag == 'a':
            if hasattr(self, 'current_attrs') and self.current_attrs:
                href = self.current_attrs.get('href', '')
                self.result.append(f']({href})')
                self.current_attrs = None
        elif tag == 'ul' or tag == 'ol':
            self.list_depth -= 1
            self.result.append('\n')
        elif tag == 'li':
            pass  # List item content already handled
        elif tag == 'th' or tag == 'td':
            self.result.append(' |')

    def handle_data(self, data):
        if self.current_tag in self.ignore_tags:
            return
        # Preserve whitespace in pre/code blocks
        if self.in_pre or self.in_code:
            self.result.append(data)
        else:
            # Normalize whitespace in regular text
            normalized = ' '.join(data.split())
            if normalized:
                self.result.append(normalized)

    def get_markdown(self):
        result = ''.join(self.result)
        # Clean up excessive newlines
        result = re.sub(r'\n{3,}', '\n\n', result)
        return result.strip()


def html_to_markdown(html_content):
    """Convert HTML content to Markdown."""
    # Handle Confluence-specific elements first

    # Handle confluence-embedded image tags
    # <ac:image> and <ri:attachment> patterns
    def replace_confluence_image(match):
        filename = match.group(1) if match.lastindex else 'image'
        return f'![{filename}](image-placeholder)'
    html_content = re.sub(r'<ri:attachment ri:filename="([^"]+)"[^/]*/>', replace_confluence_image, html_content)

    # Handle ac:image tags
    html_content = re.sub(r'<ac:image[^>]*>.*?</ac:image>', '[Image]', html_content, flags=re.DOTALL)

    # Handle Confluence macros that might not convert well
    html_content = re.sub(r'<ac:structured-macro[^>]*>.*?</ac:structured-macro>', '[Macro]', html_content, flags=re.DOTALL)

    parser = HTMLToMarkdown()
    try:
        parser.feed(html_content)
        return parser.get_markdown()
    except Exception:
        # If parsing fails, return a cleaned version of the HTML
        # Remove HTML tags and return plain text
        text = re.sub(r'<[^>]+>', '', html_content)
        text = ' '.join(text.split())
        return text


def extract_images(html_content, page_id):
    """Extract images from page content.

    Returns a list of dicts with filename and download link.
    """
    images = []
    seen = set()

    # Pattern for ri:attachment tags (Confluence storage format)
    # <ri:attachment ri:filename="image.png" ri:version-at-save="1" />
    attachment_pattern = r'<ri:attachment\s+ri:filename="([^"]+)"[^/]*/?>'

    for match in re.finditer(attachment_pattern, html_content):
        filename = match.group(1)
        # Filter for image extensions
        if any(filename.lower().endswith(ext) for ext in ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp']):
            if filename not in seen:
                seen.add(filename)
                download_url = f"{WIKI_BASE_URL}/download/attachments/{page_id}/{urllib.parse.quote(filename)}"
                images.append({
                    'filename': filename,
                    'url': download_url
                })

    return images


def extract_wiki_links(html_content):
    """Extract wiki page links from content.

    Returns a set of page IDs.
    """
    page_ids = set()

    # Pattern for internal wiki links
    # /pages/viewpage.action?pageId=12345
    link_pattern = r'/pages/viewpage\.action\?pageId=(\d+)'

    for match in re.finditer(link_pattern, html_content):
        page_ids.add(match.group(1))

    # Also check for confluence link format
    # <ri:page ri:content-title="Title" ri:space-key="SPACE" />
    # This requires looking up by title/space, which is more complex

    return page_ids


def format_comments(comments_data):
    """Format comments as markdown."""
    if not comments_data or not comments_data.get('results'):
        return ""

    comments = comments_data['results']
    output = []

    for i, comment in enumerate(comments, 1):
        title = comment.get('title', 'Untitled')

        # Get author
        history = comment.get('history', {})
        creator = history.get('createdBy', {})
        author = creator.get('displayName', creator.get('username', 'Unknown'))

        # Get date
        created_date = history.get('createdDate', '')
        if created_date:
            # Format date
            created_date = created_date.split('T')[0]  # Just the date part

        # Get content
        body = comment.get('body', {})
        storage = body.get('storage', {})
        content_html = storage.get('value', '')
        content_md = html_to_markdown(content_html)

        output.append(f"\n### 评论 {i}")
        output.append(f"**作者**: {author}")
        if created_date:
            output.append(f"**时间**: {created_date}")
        output.append(f"\n{content_md}")

    return '\n'.join(output)


def read_wiki_page(page_id, token, depth=3, current_depth=0, visited=None, include_comments=True, include_images=True):
    """Recursively read a wiki page and its references."""
    if visited is None:
        visited = set()

    # Prevent infinite loops
    if page_id in visited:
        return ""
    visited.add(page_id)

    # Check depth
    if current_depth > depth:
        return ""

    # Get page content
    page_data = get_page_content(page_id, token)

    # Extract page info
    title = page_data.get('title', 'Untitled')
    space = page_data.get('space', {}).get('name', 'Unknown')
    page_link = f"{WIKI_BASE_URL}/pages/viewpage.action?pageId={page_id}"

    # Get body content
    body = page_data.get('body', {})
    storage = body.get('storage', {})
    html_content = storage.get('value', '')

    # Convert to markdown
    markdown_content = html_to_markdown(html_content)

    # Build output
    output = []

    # Header
    if current_depth == 0:
        output.append(f"# {title}")
        output.append(f"\n**空间**: {space}")
        output.append(f"**链接**: {page_link}")
        output.append("\n---")
    else:
        output.append(f"\n---\n\n## {title}")
        output.append(f"\n**空间**: {space}")
        output.append(f"**链接**: {page_link}")

    # Page content
    output.append("\n\n## 页面内容\n")
    output.append(markdown_content)

    # Images
    if include_images:
        images = extract_images(html_content, page_id)
        if images:
            output.append("\n\n## 页面图片\n")
            output.append("| # | 文件名 | 下载链接 |")
            output.append("|---|--------|----------|")
            for i, img in enumerate(images, 1):
                output.append(f"| {i} | {img['filename']} | [{img['filename']}]({img['url']}) |")

    # Comments
    if include_comments:
        comments_data = get_comments(page_id, token)
        comments_md = format_comments(comments_data)
        if comments_md:
            comment_count = len(comments_data.get('results', []))
            output.append(f"\n\n## 评论 ({comment_count}条)")
            output.append(comments_md)

    # Recursively process referenced pages
    if current_depth < depth:
        linked_page_ids = extract_wiki_links(html_content)
        if linked_page_ids:
            output.append("\n\n## 引用页面")

            for linked_id in linked_page_ids:
                if linked_id not in visited:
                    try:
                        linked_content = read_wiki_page(
                            linked_id, token, depth,
                            current_depth + 1, visited,
                            include_comments, include_images
                        )
                        if linked_content:
                            output.append(linked_content)
                    except SystemExit:
                        # Skip pages we can't access
                        output.append(f"\n\n### 无法访问的页面 (ID: {linked_id})")
                        output.append("可能是权限不足或页面不存在。")

    return '\n'.join(output)


def main():
    parser = argparse.ArgumentParser(
        description='Read a Supermap wiki page completely including content, images, comments, and referenced pages.'
    )
    parser.add_argument(
        'url_or_id',
        help='Wiki page URL or pageId'
    )
    parser.add_argument(
        '-d', '--depth',
        type=int,
        default=3,
        help='Maximum recursion depth for referenced pages (default: 3)'
    )
    parser.add_argument(
        '--no-comments',
        action='store_true',
        help='Do not fetch comments'
    )
    parser.add_argument(
        '--no-images',
        action='store_true',
        help='Do not extract images'
    )

    args = parser.parse_args()

    # Get token
    token = get_token()

    # Parse page ID
    page_id = parse_page_id(args.url_or_id)

    # Read wiki page
    content = read_wiki_page(
        page_id, token,
        depth=args.depth,
        include_comments=not args.no_comments,
        include_images=not args.no_images
    )

    print(content)


if __name__ == '__main__':
    main()