#!/usr/bin/env node
/**
 * Supermap YouTrack Read Task Script (Node.js Version)
 *
 * Reads a single YouTrack issue with full details, including parent defect,
 * comments, and custom fields. Uses trimmedIssues API to find parent.
 * Requires SUPERMAP_YOUTRACK_TOKEN environment variable.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream');

const YOUTRACK_BASE_URL = 'yt.ispeco.com:8099';
const DEFAULT_OUT_DIR = '.tmp/youtrack';

function getToken() {
    const token = process.env.SUPERMAP_YOUTRACK_TOKEN;
    if (!token) {
        console.error('Error: SUPERMAP_YOUTRACK_TOKEN environment variable is not set.');
        process.exit(1);
    }
    return token;
}

function makeRequest(path) {
    const token = getToken();
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'yt.ispeco.com',
            port: 8099,
            path: path,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
                'User-Agent': 'Supermap-YouTrack-ReadTask/1.0'
            },
            timeout: 30000
        };

        const req = http.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error(`Failed to parse response: ${e.message}`));
                    }
                } else if (res.statusCode === 401) {
                    reject(new Error('Authentication failed. Please check your SUPERMAP_YOUTRACK_TOKEN.'));
                } else if (res.statusCode === 404) {
                    reject(new Error(`Issue not found (404). Check the issue key.`));
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

async function getIssue(issueKey) {
    const fields = 'id,idReadable,summary,description,project(id,shortName),' +
        'created,updated,' +
        'tags(id,name),' +
        'customFields(name,value(name,login,fullName,minutes,presentation)),' +
        'comments(author(login,fullName),text,created),' +
        'attachments(id,name,size,mimeType,created,author(login),url)';
    return await makeRequest(`/api/issues/${issueKey}?fields=${encodeURIComponent(fields)}`);
}

async function getIssueLinks(issueKey) {
    const fields = 'id,direction,linkType(id,sourceToTarget,targetToSource,aggregation),' +
        'trimmedIssues(id,idReadable,summary)';
    return await makeRequest(`/api/issues/${issueKey}/links?fields=${encodeURIComponent(fields)}`);
}

function findParent(links) {
    for (const link of links) {
        const linkType = link.linkType || {};
        const direction = link.direction || '';
        const trimmed = link.trimmedIssues || [];

        if (direction === 'INWARD' && trimmed.length > 0) {
            const sourceToTarget = linkType.sourceToTarget || '';
            const targetToSource = linkType.targetToSource || '';
            if (sourceToTarget.includes('parent for') || targetToSource.includes('subtask of')) {
                return trimmed[0];
            }
        }
    }
    return null;
}

function formatDate(ts) {
    if (!ts) return 'N/A';
    const d = new Date(ts);
    return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

function formatDuration(minutes) {
    if (minutes == null) return 'N/A';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h${m > 0 ? m + 'm' : ''}` : `${m}m`;
}

function formatSize(bytes) {
    if (bytes == null) return '大小未知';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Attachment names come from the server: keep the last path segment only and
// replace characters that are illegal in Windows filenames.
function safeFileName(name, fallback) {
    const segments = String(name || '').trim().split(/[\\/]/);
    const base = (segments[segments.length - 1] || '').replace(/[<>:"|?*]/g, '_');
    return base || fallback;
}

// Attachments can only be fetched from the signed url returned in
// attachments[].url. GET /api/issues/{key}/attachments/{id} returns metadata
// JSON instead, and /attachments/{id}/content is not supported (404).
function downloadAttachment(attachment, outDir) {
    if (!attachment.url) {
        return Promise.reject(new Error(`附件 ${attachment.name || attachment.id} 没有下载地址`));
    }

    const token = getToken();
    const target = path.join(outDir, safeFileName(attachment.name, String(attachment.id || 'attachment')));
    let reqPath = attachment.url;
    if (reqPath.startsWith('http')) {
        const parsed = new URL(reqPath);
        reqPath = parsed.pathname + parsed.search;
    }

    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'yt.ispeco.com',
            port: 8099,
            path: reqPath,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'User-Agent': 'Supermap-YouTrack-ReadTask/1.0'
            },
            timeout: 120000
        };

        const req = http.request(options, (res) => {
            if (res.statusCode === 401) {
                res.resume();
                reject(new Error('Authentication failed. Please check your SUPERMAP_YOUTRACK_TOKEN.'));
                return;
            }
            if (res.statusCode < 200 || res.statusCode >= 300) {
                res.resume();
                reject(new Error(`HTTP ${res.statusCode} while downloading ${attachment.name || attachment.id}`));
                return;
            }

            // Stream straight to disk: accumulating chunks into a string would
            // corrupt binary attachments such as images or archives.
            pipeline(res, fs.createWriteStream(target), (err) => {
                if (err) reject(new Error(`Failed to save ${target}: ${err.message}`));
                else resolve(target);
            });
        });

        req.on('error', (err) => {
            reject(new Error(`Network error: ${err.message}`));
        });
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Download timeout'));
        });
        req.end();
    });
}

function formatOutput(issue, parentIssue, parentComments) {
    const lines = [];
    const key = issue.idReadable || 'N/A';
    const summary = issue.summary || 'N/A';

    lines.push('='.repeat(72));
    lines.push(`  YouTrack 任务详情: ${key}`);
    lines.push('='.repeat(72));
    lines.push('');
    lines.push(`📋 ${key}: ${summary}`);
    lines.push('─'.repeat(40));
    lines.push(`  链接: http://${YOUTRACK_BASE_URL}/issue/${key}`);

    // Project
    if (issue.project) {
        lines.push(`  项目: ${issue.project.shortName || ''} - ${issue.project.name || ''}`);
    }

    // Tags
    const tags = issue.tags || [];
    if (tags.length > 0) {
        lines.push(`  标签: ${tags.map(t => t.name).join(', ')}`);
    }

    // Custom fields
    if (issue.customFields) {
        for (const cf of issue.customFields) {
            const name = cf.name || '';
            let val = '-';
            const v = cf.value;
            if (v) {
                if (v.login) val = `${v.fullName || v.name || v.login} (${v.login})`;
                else if (v.name) val = v.name;
                else if (Array.isArray(v)) val = v.map(x => x.name || x).join(', ');
                else if (v.minutes != null) val = formatDuration(v.minutes);
                else if (v.presentation) val = v.presentation;
                else val = JSON.stringify(v);
            }
            lines.push(`  ${name}: ${val}`);
        }
    }

    // Description
    lines.push('');
    lines.push('📝 描述');
    lines.push('─'.repeat(40));
    lines.push(issue.description || '(无描述)');

    // Attachments
    const attachments = issue.attachments || [];
    lines.push('');
    lines.push(`📎 附件 (${attachments.length}个)`);
    lines.push('─'.repeat(40));
    if (attachments.length === 0) {
        lines.push('  (无附件)');
    } else {
        for (let i = 0; i < attachments.length; i++) {
            const a = attachments[i];
            const author = a.author ? (a.author.login || a.author.fullName || '未知') : '未知';
            lines.push(`  ${i + 1}. ${a.name || 'N/A'}  (${formatSize(a.size)}${a.mimeType ? ', ' + a.mimeType : ''})`);
            lines.push(`     上传: ${author}  ${formatDate(a.created)}`);
        }
        lines.push(`  下载: node scripts/read_task.js ${key} --download`);
    }

    // Parent defect
    lines.push('');
    lines.push('🔗 父缺陷');
    lines.push('─'.repeat(40));
    if (parentIssue) {
        lines.push(`  ${parentIssue.idReadable}: ${parentIssue.summary}`);
        lines.push(`  http://${YOUTRACK_BASE_URL}/issue/${parentIssue.idReadable}`);
    } else {
        lines.push('  (无父缺陷)');
    }

    // Issue's own comments
    const issueComments = issue.comments || [];
    lines.push('');
    lines.push(`💬 备注 (${issueComments.length}条)`);
    lines.push('─'.repeat(40));
    if (issueComments.length === 0) {
        lines.push('  (无备注)');
    } else {
        for (let i = 0; i < issueComments.length; i++) {
            const c = issueComments[i];
            const author = c.author ? (c.author.fullName || c.author.login || '未知') : '未知';
            const time = formatDate(c.created);
            const text = c.text || '';
            lines.push('');
            lines.push(`  --- 备注 ${i + 1} ---`);
            lines.push(`  作者: ${author}`);
            lines.push(`  时间: ${time}`);
            lines.push(`  内容:`);
            for (const line of text.split('\n')) {
                lines.push(`    ${line}`);
            }
        }
    }

    // Parent defect comments (if different from own)
    if (parentIssue && parentComments && parentComments.length > 0) {
        lines.push('');
        lines.push(`🔗 父缺陷备注 (${parentComments.length}条)`);
        lines.push('─'.repeat(40));
        for (let i = 0; i < parentComments.length; i++) {
            const c = parentComments[i];
            const author = c.author ? (c.author.fullName || c.author.login || '未知') : '未知';
            const time = formatDate(c.created);
            const text = c.text || '';
            lines.push('');
            lines.push(`  --- 备注 ${i + 1} ---`);
            lines.push(`  作者: ${author}`);
            lines.push(`  时间: ${time}`);
            lines.push(`  内容:`);
            for (const line of text.split('\n')) {
                lines.push(`    ${line}`);
            }
        }
    }

    lines.push('');
    lines.push('='.repeat(72));
    return lines.join('\n');
}

function parseArgs(args) {
    const opts = { issueKey: null, download: false, outDir: null };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '-d' || arg === '--download') {
            opts.download = true;
        } else if (arg === '-o' || arg === '--out') {
            const dir = args[++i];
            if (!dir) throw new Error(`${arg} requires a directory argument`);
            opts.outDir = dir;
            opts.download = true;
        } else if (!opts.issueKey && !arg.startsWith('-')) {
            opts.issueKey = arg;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (!opts.issueKey) throw new Error('Missing issue key');
    if (!opts.outDir) opts.outDir = path.join(process.cwd(), DEFAULT_OUT_DIR, opts.issueKey);
    return opts;
}

function printHelp() {
    console.log(`Supermap YouTrack Read Task

Usage: node read_task.js <issue-key> [options]

Description:
    Read a single YouTrack issue's full details including parent defect,
    comments, custom fields, and attachments.

Options:
    -d, --download   Download all attachments of the issue.
    -o, --out <dir>  Directory to save attachments (implies --download).
                     Default: <cwd>/${DEFAULT_OUT_DIR}/<issue-key>/
    -h, --help       Show this help.

Examples:
    node read_task.js CS-5412
    node read_task.js CS-5355
    node read_task.js ICN-2690 --download
    node read_task.js ICN-2690 -o D:/logs/icn2690

Environment:
    SUPERMAP_YOUTRACK_TOKEN  - Required. Your YouTrack API token.
`);
}

async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
        printHelp();
        process.exit(0);
    }

    let opts;
    try {
        opts = parseArgs(args);
    } catch (error) {
        console.error(`Error: ${error.message}`);
        console.error('Run "node read_task.js --help" for usage.');
        process.exit(1);
    }

    const issueKey = opts.issueKey;

    try {
        // Step 1: Get issue details
        const issue = await getIssue(issueKey);

        // Step 2: Get links to find parent
        const links = await getIssueLinks(issueKey);
        const parent = findParent(links);

        // Step 3: If parent exists, get parent details and comments
        let parentIssue = null;
        let parentComments = [];
        if (parent) {
            parentIssue = await getIssue(parent.idReadable);
            parentComments = parentIssue.comments || [];
        }

        // Step 4: Output
        const output = formatOutput(issue, parent, parentComments);
        console.log(output);

        // Step 5: Download attachments when explicitly requested
        if (opts.download) {
            const attachments = issue.attachments || [];
            if (attachments.length === 0) {
                console.log('无附件可下载。');
                return;
            }

            fs.mkdirSync(opts.outDir, { recursive: true });
            console.log(`下载附件 (${attachments.length}个) 到: ${opts.outDir}`);

            for (const att of attachments) {
                try {
                    const saved = await downloadAttachment(att, opts.outDir);
                    const size = fs.statSync(saved).size;
                    if (att.size != null && size !== att.size) {
                        console.log(`  ! ${path.basename(saved)}  ${size} 字节 (服务端声明 ${att.size} 字节，大小不一致)`);
                    } else {
                        console.log(`  - ${path.basename(saved)}  ${size} 字节`);
                    }
                } catch (error) {
                    console.error(`  x ${att.name || att.id}: ${error.message}`);
                    process.exitCode = 1;
                }
            }
        }

    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

main().catch(err => {
    console.error(`Unexpected error: ${err.message}`);
    process.exit(1);
});
