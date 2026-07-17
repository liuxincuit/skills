#!/usr/bin/env node
/**
 * Supermap YouTrack Tag Manager Script
 *
 * Supports: list tags, search tags, create tag, add tag to issue, remove tag from issue.
 *
 * Environment: SUPERMAP_YOUTRACK_TOKEN
 */

const http = require('http');

const YOUTRACK_HOST = 'yt.ispeco.com';
const YOUTRACK_PORT = 8099;

function getToken() {
    const token = process.env.SUPERMAP_YOUTRACK_TOKEN;
    if (!token) {
        console.error('Error: SUPERMAP_YOUTRACK_TOKEN environment variable is not set.');
        process.exit(1);
    }
    return token;
}

function apiRequest(method, path, body) {
    const token = getToken();
    return new Promise((resolve, reject) => {
        const opts = {
            hostname: YOUTRACK_HOST,
            port: YOUTRACK_PORT,
            path: path,
            method: method,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
                'User-Agent': 'Supermap-YouTrack-TagManager/1.0'
            },
            timeout: 30000
        };
        if (body) {
            const bodyStr = JSON.stringify(body);
            opts.headers['Content-Type'] = 'application/json';
            opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
        }
        const req = http.request(opts, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve({ status: res.statusCode, data: JSON.parse(data) });
                    } catch (e) {
                        resolve({ status: res.statusCode, data: data });
                    }
                } else if (res.statusCode === 401) {
                    reject(new Error('Authentication failed (401). Check your SUPERMAP_YOUTRACK_TOKEN.'));
                } else if (res.statusCode === 404) {
                    reject(new Error('Resource not found (404).'));
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
                }
            });
        });
        req.on('error', err => reject(new Error(`Network error: ${err.message}`)));
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

function formatTagList(tags) {
    if (!tags || tags.length === 0) {
        console.log('(无标签)');
        return;
    }
    console.log('ID\t名称');
    console.log('--\t----');
    for (const t of tags) {
        console.log(`${t.id}\t${t.name}`);
    }
}

async function listTags(keyword) {
    let path = '/api/tags?fields=id,name&$top=200';
    if (keyword) {
        path += `&query=${encodeURIComponent(keyword)}`;
    }
    const result = await apiRequest('GET', path);
    return result.data;
}

async function createTag(name) {
    const result = await apiRequest('POST', '/api/tags?fields=id,name', { name });
    return result.data;
}

async function addTagToIssue(issueKey, tagName) {
    // First, find or create the tag
    let tags = await listTags(tagName);
    let tag = tags.find(t => t.name === tagName);
    if (!tag) {
        console.log(`Tag "${tagName}" not found, creating...`);
        tag = await createTag(tagName);
        console.log(`Created tag: ${tag.name} (${tag.id})`);
    }
    // Get existing tags on the issue, then append the new one
    const issue = await apiRequest('GET', `/api/issues/${issueKey}?fields=id,idReadable,tags(id,name)`);
    const existingTagIds = (issue.data.tags || []).map(t => t.id);
    const allTagIds = existingTagIds.includes(tag.id)
        ? existingTagIds
        : [...existingTagIds, tag.id];
    // POST with merged tag list (YouTrack replaces, not appends)
    const result = await apiRequest('POST', `/api/issues/${issueKey}?fields=id,idReadable,tags(id,name)`, {
        tags: allTagIds.map(id => ({ id }))
    });
    return result.data;
}

async function removeTagFromIssue(issueKey, tagName) {
    // Find the tag
    const tags = await listTags(tagName);
    const tag = tags.find(t => t.name === tagName);
    if (!tag) {
        throw new Error(`Tag "${tagName}" not found.`);
    }
    // Get current issue tags
    const issue = await apiRequest('GET', `/api/issues/${issueKey}?fields=id,idReadable,tags(id,name)`);
    const currentTagIds = (issue.data.tags || []).map(t => t.id);
    if (!currentTagIds.includes(tag.id)) {
        console.log(`Issue ${issueKey} does not have tag "${tagName}". Nothing to remove.`);
        return issue.data;
    }
    const remainingTags = currentTagIds.filter(id => id !== tag.id);
    const result = await apiRequest('POST', `/api/issues/${issueKey}?fields=id,idReadable,tags(id,name)`, {
        tags: remainingTags.map(id => ({ id }))
    });
    return result.data;
}

async function showHelp() {
    console.log(`Supermap YouTrack Tag Manager

Usage:
  node scripts/manage_tag.js list [关键词]              列出所有标签或搜索标签
  node scripts/manage_tag.js list-issue <issue-key>     列出 issue 的标签
  node scripts/manage_tag.js create <名称>               创建新标签
  node scripts/manage_tag.js add <issue-key> <标签名>   为 issue 添加标签
  node scripts/manage_tag.js remove <issue-key> <标签名> 移除 issue 的标签

Examples:
  node scripts/manage_tag.js list
  node scripts/manage_tag.js list clearly
  node scripts/manage_tag.js list-issue CS-5451
  node scripts/manage_tag.js create clearly
  node scripts/manage_tag.js add CS-5451 clearly
  node scripts/manage_tag.js remove CS-5451 clearly

Environment:
  SUPERMAP_YOUTRACK_TOKEN  - Required. Your YouTrack API token.
`);
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
        showHelp();
        return;
    }

    const command = args[0];

    try {
        switch (command) {
            case 'list': {
                const keyword = args[1] || '';
                const tags = await listTags(keyword);
                formatTagList(tags);
                break;
            }
            case 'list-issue': {
                if (!args[1]) {
                    console.error('Error: Missing issue key. Usage: node scripts/manage_tag.js list-issue <issue-key>');
                    process.exit(1);
                }
                const issue = await apiRequest('GET', `/api/issues/${args[1]}?fields=id,idReadable,tags(id,name)`);
                const issueTags = (issue.data && issue.data.tags) || [];
                formatTagList(issueTags);
                break;
            }
            case 'create': {
                if (!args[1]) {
                    console.error('Error: Missing tag name. Usage: node scripts/manage_tag.js create <名称>');
                    process.exit(1);
                }
                const tag = await createTag(args[1]);
                console.log(`Created tag: ${tag.name} (${tag.id})`);
                break;
            }
            case 'add': {
                if (!args[1] || !args[2]) {
                    console.error('Error: Missing arguments. Usage: node scripts/manage_tag.js add <issue-key> <标签名>');
                    process.exit(1);
                }
                const issue = await addTagToIssue(args[1], args[2]);
                const tagNames = (issue.tags || []).map(t => t.name).join(', ');
                console.log(`Tag added. Issue ${issue.idReadable} now has tags: [${tagNames}]`);
                break;
            }
            case 'remove': {
                if (!args[1] || !args[2]) {
                    console.error('Error: Missing arguments. Usage: node scripts/manage_tag.js remove <issue-key> <标签名>');
                    process.exit(1);
                }
                const issue = await removeTagFromIssue(args[1], args[2]);
                const tagNames = (issue.tags || []).map(t => t.name).join(', ');
                console.log(`Tag removed. Issue ${issue.idReadable} now has tags: [${tagNames || '(无)'}]`);
                break;
            }
            default:
                console.error(`Unknown command: ${command}`);
                showHelp();
                process.exit(1);
        }
    } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
    }
}

main().catch(err => {
    console.error(`Unexpected error: ${err.message}`);
    process.exit(1);
});
