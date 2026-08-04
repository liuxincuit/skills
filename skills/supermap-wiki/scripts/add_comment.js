#!/usr/bin/env node
/**
 * Supermap Wiki Add Comment Script
 *
 * Adds a comment to a wiki page.
 * Environment: SUPERMAP_WIKI_TOKEN
 */

const https = require('https');
const fs = require('fs');

const WIKI_BASE_URL = 'wiki.ispeco.com';

function getToken() {
    const token = process.env.SUPERMAP_WIKI_TOKEN;
    if (!token) {
        console.error('Error: SUPERMAP_WIKI_TOKEN environment variable is not set.');
        process.exit(1);
    }
    return token;
}

const HELP_TEXT = `Supermap Wiki Add Comment

Usage:
  node scripts/add_comment.js <pageId> <评论文本或文件路径>

Examples:
  node scripts/add_comment.js 130526896 "任务已完成，详见评论"
  node scripts/add_comment.js 130526896 ./result.md

Environment:
  SUPERMAP_WIKI_TOKEN  - Required. Your wiki API token.
`;

function escapeXml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function textToStorage(text) {
    const paragraphs = text
        .replace(/\r\n/g, '\n')
        .split(/\n\s*\n/)
        .map((p) => escapeXml(p).replace(/\n/g, '<br/>').trim())
        .filter((p) => p.length > 0);
    return paragraphs.map((p) => `<p>${p}</p>`).join('');
}

function addComment(pageId, content, token) {
    return new Promise((resolve, reject) => {
        const storageValue = textToStorage(content);
        const postData = JSON.stringify({
            type: 'comment',
            container: { id: pageId, type: 'page' },
            body: {
                storage: {
                    value: storageValue,
                    representation: 'storage'
                }
            }
        });
        const req = https.request({
            hostname: WIKI_BASE_URL,
            path: '/rest/api/content',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
                'User-Agent': 'Supermap-Wiki-AddComment/1.0'
            },
            timeout: 30000,
            rejectUnauthorized: false
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        resolve(data);
                    }
                } else if (res.statusCode === 401) {
                    reject(new Error('Authentication failed. Please check your SUPERMAP_WIKI_TOKEN.'));
                } else if (res.statusCode === 403) {
                    reject(new Error('Access forbidden. You may not have permission to comment on this page.'));
                } else if (res.statusCode === 404) {
                    reject(new Error('Page not found. Please check the pageId.'));
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
                }
            });
        });
        req.on('error', (err) => reject(new Error(`Network error: ${err.message}`)));
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        req.write(postData);
        req.end();
    });
}

async function main() {
    const args = process.argv.slice(2);
    if (args[0] === '--help' || args[0] === '-h') {
        console.log(HELP_TEXT);
        process.exit(0);
    }
    if (args.length < 2) {
        console.log(HELP_TEXT);
        process.exit(1);
    }
    const pageId = args[0];
    const input = args.slice(1).join(' ');
    const token = getToken();

    let content = input;
    if (fs.existsSync(input) && fs.statSync(input).isFile()) {
        try {
            content = fs.readFileSync(input, 'utf8');
        } catch (err) {
            console.error(`Error: Cannot read content file: ${input}`);
            process.exit(1);
        }
    }
    if (!content.trim()) {
        console.error('Error: Comment content is empty.');
        process.exit(1);
    }

    try {
        const result = await addComment(pageId, content, token);
        console.log(`Comment added to page ${pageId} successfully.`);
        if (result && result.id) {
            console.log(`Comment ID: ${result.id}`);
        }
    } catch (err) {
        console.error(`Failed to add comment: ${err.message}`);
        process.exit(1);
    }
}

main().catch((err) => {
    console.error(`Unexpected error: ${err.message}`);
    process.exit(1);
});
