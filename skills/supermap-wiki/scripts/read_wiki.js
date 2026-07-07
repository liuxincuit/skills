#!/usr/bin/env node
/**
 * Supermap Wiki Read Script (Node.js Version)
 *
 * Reads a wiki page completely including content, images, comments,
 * and recursively parses referenced wiki pages.
 */

const https = require('https');

const WIKI_BASE_URL = 'wiki.ispeco.com';
const API_BASE_URL = '/rest/api';

function getToken() {
    const token = process.env.SUPERMAP_WIKI_TOKEN;
    if (!token) {
        console.error('Error: SUPERMAP_WIKI_TOKEN environment variable is not set.');
        console.error('Please set it using:');
        console.error('  Linux/macOS: export SUPERMAP_WIKI_TOKEN=\'your-token\'');
        console.error('  Windows (cmd): set SUPERMAP_WIKI_TOKEN=your-token');
        console.error('  Windows (PowerShell): $env:SUPERMAP_WIKI_TOKEN=\'your-token\'');
        process.exit(1);
    }
    return token;
}

function parsePageId(urlOrId) {
    // If it's just a number, return it
    if (/^\d+$/.test(urlOrId)) {
        return urlOrId;
    }

    // Try to extract pageId from URL
    try {
        const url = new URL(urlOrId);
        const pageId = url.searchParams.get('pageId');
        if (pageId) {
            return pageId;
        }
    } catch (e) {
        // Not a valid URL
    }

    console.error(`Error: Could not extract pageId from URL: ${urlOrId}`);
    console.error('Please use a URL with pageId parameter or provide the pageId directly.');
    process.exit(1);
}

function makeApiRequest(path, token) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: WIKI_BASE_URL,
            path: path,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
                'User-Agent': 'Supermap-Wiki-Read/1.0'
            },
            timeout: 30000,
            rejectUnauthorized: false
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const jsonData = JSON.parse(data);
                        resolve(jsonData);
                    } catch (e) {
                        reject(new Error(`Failed to parse response: ${e.message}`));
                    }
                } else if (res.statusCode === 401) {
                    reject(new Error('Authentication failed. Please check your SUPERMAP_WIKI_TOKEN.'));
                } else if (res.statusCode === 403) {
                    reject(new Error('Access forbidden. You may not have permission to access this page.'));
                } else if (res.statusCode === 404) {
                    reject(new Error('Page not found. Please check the pageId or URL.'));
                } else {
                    reject(new Error(`HTTP ${res.statusCode}`));
                }
            });
        });

        req.on('error', (err) => {
            reject(new Error(`Network error: ${err.message}`));
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        req.end();
    });
}

async function getPageContent(pageId, token) {
    const url = `${API_BASE_URL}/content/${pageId}?expand=body.storage,space,version,history`;
    return makeApiRequest(url, token);
}

async function getComments(pageId, token) {
    const url = `${API_BASE_URL}/content/${pageId}/child/comment?expand=body.storage,history&limit=100`;
    try {
        return makeApiRequest(url, token);
    } catch (error) {
        // If comments fail, return empty results
        return { results: [] };
    }
}

async function getCommentReplies(commentId, token) {
    const url = `${API_BASE_URL}/content/${commentId}/child/comment?expand=body.storage,history&limit=100`;
    try {
        return makeApiRequest(url, token);
    } catch (error) {
        return { results: [] };
    }
}

// Simple HTML to Markdown converter
class HTMLToMarkdown {
    constructor() {
        this.result = [];
        this.inPre = false;
        this.inCode = false;
        this.listDepth = 0;
        this.listType = null;
        this.currentAttrs = {};
    }

    convert(html) {
        if (!html) return '';

        // Handle Confluence-specific elements first
        html = html
            .replace(/<ri:attachment\s+ri:filename="([^"]+)"[^/]*\/?>/g, '![$1](image-placeholder)')
            .replace(/<ac:image[^>]*>.*?<\/ac:image>/gs, '[Image]')
            // Extract markdown content from markdown macro
            .replace(/<ac:structured-macro[^>]*ac:name="markdown"[^>]*>[\s\S]*?<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>[\s\S]*?<\/ac:structured-macro>/gi, '\n$1\n')
            // Handle code block macro (ac:name="code")
            .replace(/<ac:structured-macro[^>]*ac:name="code"[^>]*>[\s\S]*?<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>[\s\S]*?<\/ac:structured-macro>/gi, '\n```\n$1\n```\n')
            // Other macros: try to extract plain-text-body if exists
            .replace(/<ac:structured-macro[^>]*>[\s\S]*?<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>[\s\S]*?<\/ac:structured-macro>/gs, '\n$1\n')
            // Macros without plain-text-body
            .replace(/<ac:structured-macro[^>]*>[\s\S]*?<\/ac:structured-macro>/gs, '[Macro]');

        // Simple tag replacement approach
        let text = html;

        // Block elements
        text = text.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n# $1\n');
        text = text.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n## $1\n');
        text = text.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n### $1\n');
        text = text.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '\n#### $1\n');
        text = text.replace(/<h5[^>]*>(.*?)<\/h5>/gi, '\n##### $1\n');
        text = text.replace(/<h6[^>]*>(.*?)<\/h6>/gi, '\n###### $1\n');

        text = text.replace(/<p[^>]*>(.*?)<\/p>/gi, '\n$1\n');
        text = text.replace(/<br\s*\/?>/gi, '  \n');
        text = text.replace(/<hr\s*\/?>/gi, '\n---\n');

        // Inline formatting
        text = text.replace(/<(strong|b)[^>]*>(.*?)<\/(strong|b)>/gi, '**$2**');
        text = text.replace(/<(em|i)[^>]*>(.*?)<\/(em|i)>/gi, '*$2*');
        text = text.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');
        text = text.replace(/<pre[^>]*>(.*?)<\/pre>/gi, '\n```\n$1\n```\n');

        // Blockquote
        text = text.replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gi, (match, content) => {
            return content.split('\n').map(line => '> ' + line).join('\n');
        });

        // Links
        text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');

        // Images
        text = text.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, '![$2]($1)');
        text = text.replace(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*\/?>/gi, '![$1]($2)');
        text = text.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, '![image]($1)');

        // Lists - simple handling
        text = this.processLists(text);

        // Tables - simple handling
        text = this.processTables(text);

        // Remove remaining HTML tags
        text = text.replace(/<[^>]+>/g, '');

        // Clean up
        text = text.replace(/\n{3,}/g, '\n\n');
        text = text.trim();

        return text;
    }

    processLists(text) {
        // Unordered lists
        let depth = 0;
        text = text.replace(/<(ul|ol)[^>]*>/gi, () => {
            depth++;
            return '\n';
        });
        text = text.replace(/<\/ul>/gi, () => {
            depth--;
            return '\n';
        });
        text = text.replace(/<\/ol>/gi, () => {
            depth--;
            return '\n';
        });

        // List items
        text = text.replace(/<li[^>]*>(.*?)<\/li>/gi, (match, content) => {
            const indent = '  '.repeat(Math.max(0, depth - 1));
            return `${indent}- ${content.trim()}\n`;
        });

        return text;
    }

    processTables(text) {
        // Simple table handling - convert to text representation
        text = text.replace(/<table[^>]*>(.*?)<\/table>/gis, (match, content) => {
            const rows = [];
            const rowMatches = content.match(/<tr[^>]*>(.*?)<\/tr>/gis);
            if (rowMatches) {
                for (const row of rowMatches) {
                    const cells = [];
                    const cellMatches = row.match(/<t[dh][^>]*>(.*?)<\/t[dh]>/gi);
                    if (cellMatches) {
                        for (const cell of cellMatches) {
                            const cellContent = cell.replace(/<[^>]+>/g, '').trim();
                            cells.push(cellContent);
                        }
                    }
                    if (cells.length > 0) {
                        rows.push('| ' + cells.join(' | ') + ' |');
                    }
                }
            }
            return '\n' + rows.join('\n') + '\n';
        });
        return text;
    }
}

function htmlToMarkdown(htmlContent) {
    if (!htmlContent) return '';
    const converter = new HTMLToMarkdown();
    return converter.convert(htmlContent);
}

function extractImages(htmlContent, pageId) {
    const images = [];
    const seen = new Set();

    // Pattern for ri:attachment tags
    const attachmentPattern = /<ri:attachment\s+ri:filename="([^"]+)"[^/]*\/?>/g;
    let match;

    while ((match = attachmentPattern.exec(htmlContent)) !== null) {
        const filename = match[1];
        const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp'];
        if (imageExts.some(ext => filename.toLowerCase().endsWith(ext))) {
            if (!seen.has(filename)) {
                seen.add(filename);
                const downloadUrl = `https://${WIKI_BASE_URL}/download/attachments/${pageId}/${encodeURIComponent(filename)}`;
                images.push({
                    filename: filename,
                    url: downloadUrl
                });
            }
        }
    }

    return images;
}

function extractWikiLinks(htmlContent) {
    const pageIds = new Set();

    // Pattern for internal wiki links
    const linkPattern = /\/pages\/viewpage\.action\?pageId=(\d+)/g;
    let match;

    while ((match = linkPattern.exec(htmlContent)) !== null) {
        pageIds.add(match[1]);
    }

    return Array.from(pageIds);
}

function formatDate(dateString) {
    if (!dateString) return '';
    return dateString.split('T')[0]; // Just the date part
}

function countAllComments(commentsData, repliesMap) {
    let count = 0;
    if (!commentsData || !commentsData.results) return 0;
    count = commentsData.results.length;
    for (const comment of commentsData.results) {
        const replies = repliesMap[comment.id];
        if (replies) {
            count += countAllComments(replies, repliesMap);
        }
    }
    return count;
}

function formatCommentTree(commentsData, repliesMap, depth, maxDepth, prefix) {
    if (!commentsData || !commentsData.results || commentsData.results.length === 0) {
        return '';
    }

    const output = [];

    for (let i = 0; i < commentsData.results.length; i++) {
        const comment = commentsData.results[i];
        const history = comment.history || {};
        const creator = history.createdBy || {};
        const author = creator.displayName || creator.username || 'Unknown';
        const createdDate = formatDate(history.createdDate);

        const body = comment.body || {};
        const storage = body.storage || {};
        const contentHtml = storage.value || '';
        const contentMd = htmlToMarkdown(contentHtml);

        if (depth === 0) {
            output.push(`\n### 评论 ${i + 1}`);
            output.push(`**作者**: ${author}`);
        } else {
            output.push(`\n${prefix}回复 — **作者**: ${author}`);
        }
        if (createdDate) {
            output.push(`**时间**: ${createdDate}`);
        }
        output.push(`\n${contentMd}`);

        // Recursively format replies
        if (depth < maxDepth) {
            const replies = repliesMap[comment.id];
            if (replies && replies.results && replies.results.length > 0) {
                const childPrefix = prefix + '    ';
                const childMd = formatCommentTree(replies, repliesMap, depth + 1, maxDepth, childPrefix);
                if (childMd) {
                    output.push(childMd);
                }
            }
        }
    }

    return output.join('\n');
}

async function fetchAllReplies(commentsData, token, repliesMap, depth, maxDepth) {
    if (!commentsData || !commentsData.results || depth >= maxDepth) return;

    for (const comment of commentsData.results) {
        const replies = await getCommentReplies(comment.id, token);
        if (replies && replies.results && replies.results.length > 0) {
            repliesMap[comment.id] = replies;
            await fetchAllReplies(replies, token, repliesMap, depth + 1, maxDepth);
        }
    }
}

function formatComments(commentsData, repliesMap) {
    if (!commentsData || !commentsData.results || commentsData.results.length === 0) {
        return { markdown: '', count: 0 };
    }

    const count = countAllComments(commentsData, repliesMap);
    const markdown = formatCommentTree(commentsData, repliesMap, 0, Infinity, '└── ');
    return { markdown, count };
}

async function readWikiPage(pageId, token, options = {}) {
    const {
        depth = 3,
        maxCommentDepth = Infinity,
        currentDepth = 0,
        visited = new Set(),
        includeComments = true,
        includeImages = true
    } = options;

    // Prevent infinite loops
    if (visited.has(pageId)) {
        return '';
    }
    visited.add(pageId);

    // Check depth
    if (currentDepth > depth) {
        return '';
    }

    // Get page content
    let pageData;
    try {
        pageData = await getPageContent(pageId, token);
    } catch (error) {
        if (currentDepth === 0) {
            throw error;
        }
        return `\n\n### 无法访问的页面 (ID: ${pageId})\n可能是权限不足或页面不存在。`;
    }

    // Extract page info
    const title = pageData.title || 'Untitled';
    const space = pageData.space?.name || 'Unknown';
    const pageLink = `https://${WIKI_BASE_URL}/pages/viewpage.action?pageId=${pageId}`;

    // Get body content
    const body = pageData.body || {};
    const storage = body.storage || {};
    const htmlContent = storage.value || '';

    // Convert to markdown
    const markdownContent = htmlToMarkdown(htmlContent);

    // Build output
    const output = [];

    // Header
    if (currentDepth === 0) {
        output.push(`# ${title}`);
        output.push(`\n**空间**: ${space}`);
        output.push(`**链接**: ${pageLink}`);
        output.push('\n---');
    } else {
        output.push(`\n---\n\n## ${title}`);
        output.push(`\n**空间**: ${space}`);
        output.push(`**链接**: ${pageLink}`);
    }

    // Page content
    output.push('\n\n## 页面内容\n');
    output.push(markdownContent);

    // Images
    if (includeImages) {
        const images = extractImages(htmlContent, pageId);
        if (images.length > 0) {
            output.push('\n\n## 页面图片\n');
            output.push('| # | 文件名 | 下载链接 |');
            output.push('|---|--------|----------|');
            for (let i = 0; i < images.length; i++) {
                const img = images[i];
                output.push(`| ${i + 1} | ${img.filename} | [${img.filename}](${img.url}) |`);
            }
        }
    }

    // Comments
    if (includeComments) {
        try {
            const commentsData = await getComments(pageId, token);
            if (commentsData.results && commentsData.results.length > 0) {
                const repliesMap = {};
                await fetchAllReplies(commentsData, token, repliesMap, 0, maxCommentDepth);
                const { markdown: commentsMd, count: commentCount } = formatComments(commentsData, repliesMap);
                if (commentsMd) {
                    output.push(`\n\n## 评论 (${commentCount}条)`);
                    output.push(commentsMd);
                }
            }
        } catch (e) {
            // Skip comments on error
        }
    }

    // Recursively process referenced pages
    if (currentDepth < depth) {
        const linkedPageIds = extractWikiLinks(htmlContent);
        if (linkedPageIds.length > 0) {
            output.push('\n\n## 引用页面');

            for (const linkedId of linkedPageIds) {
                if (!visited.has(linkedId)) {
                    try {
                        const linkedContent = await readWikiPage(linkedId, token, {
                            depth,
                            maxCommentDepth,
                            currentDepth: currentDepth + 1,
                            visited,
                            includeComments,
                            includeImages
                        });
                        if (linkedContent) {
                            output.push(linkedContent);
                        }
                    } catch (e) {
                        output.push(`\n\n### 无法访问的页面 (ID: ${linkedId})`);
                        output.push('可能是权限不足或页面不存在。');
                    }
                }
            }
        }
    }

    return output.join('\n');
}

function printHelp() {
    console.log(`Supermap Wiki Read (Node.js Version)

Usage: node read_wiki.js <url_or_id> [options]

Description:
    Read a Supermap wiki page completely including content, images, comments, and referenced pages.

Environment Variables:
    SUPERMAP_WIKI_TOKEN  - Required. Your wiki API token for authentication.

Options:
    -d, --depth <number>            Maximum recursion depth for referenced pages (default: 3)
    --max-comment-depth <number>   Maximum recursion depth for comment replies (default: unlimited)
    --no-comments                   Do not fetch comments
    --no-images                     Do not extract images
    -h, --help                      Show this help message

Examples:
    node read_wiki.js 12345
    node read_wiki.js "https://wiki.ispeco.com/pages/viewpage.action?pageId=12345"
    node read_wiki.js 12345 -d 2
    node read_wiki.js 12345 --no-comments

Output:
    Complete page content in markdown format including images and comments.
`);
}

function parseArgs(args) {
    const result = {
        urlOrId: '',
        depth: 3,
        maxCommentDepth: Infinity,
        includeComments: true,
        includeImages: true,
        help: false
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === '-h' || arg === '--help') {
            result.help = true;
        } else if ((arg === '-d' || arg === '--depth') && i + 1 < args.length) {
            const depth = parseInt(args[i + 1], 10);
            if (!isNaN(depth) && depth >= 0) {
                result.depth = depth;
            }
            i++;
        } else if (arg === '--max-comment-depth' && i + 1 < args.length) {
            const depth = parseInt(args[i + 1], 10);
            if (!isNaN(depth) && depth >= 1) {
                result.maxCommentDepth = depth;
            }
            i++;
        } else if (arg === '--no-comments') {
            result.includeComments = false;
        } else if (arg === '--no-images') {
            result.includeImages = false;
        } else if (!result.urlOrId) {
            result.urlOrId = arg;
        } else {
            result.urlOrId += ' ' + arg;
        }
    }

    return result;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    if (args.help || !args.urlOrId) {
        printHelp();
        process.exit(0);
    }

    const token = getToken();
    const pageId = parsePageId(args.urlOrId);

    try {
        const content = await readWikiPage(pageId, token, {
            depth: args.depth,
            maxCommentDepth: args.maxCommentDepth,
            includeComments: args.includeComments,
            includeImages: args.includeImages
        });
        console.log(content);
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

main().catch(err => {
    console.error(`Unexpected error: ${err.message}`);
    process.exit(1);
});
