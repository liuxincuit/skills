#!/usr/bin/env node
/**
 * Supermap Jira 标签管理脚本
 *
 * 支持：
 *   --list                列出 Jira 系统中所有标签
 *   --add <key> <label>   给 issue 添加标签（追加式，保留已有标签）
 *   --remove <key> <label> 从 issue 移除标签
 *
 * 使用 SUPERMAP_JIRA_TOKEN 环境变量认证。
 */

const https = require('https');

const JIRA_BASE_URL = 'jira.supermap.work';
const TOKEN_ENV_VAR = 'SUPERMAP_JIRA_TOKEN';

function getToken() {
    const token = process.env[TOKEN_ENV_VAR];
    if (!token) {
        console.error(`Error: ${TOKEN_ENV_VAR} environment variable is not set.`);
        console.error('Please set it with:');
        console.error("  Linux/macOS: export SUPERMAP_JIRA_TOKEN='your-token-here'");
        console.error('  Windows (cmd): set SUPERMAP_JIRA_TOKEN=your-token-here');
        console.error("  Windows (PowerShell): $env:SUPERMAP_JIRA_TOKEN='your-token-here'");
        process.exit(1);
    }
    return token;
}

function parseIssueKey(input) {
    if (!input) return null;
    input = input.trim();
    const urlMatch = input.match(/browse\/(\w+-\d+)/);
    if (urlMatch) return urlMatch[1];
    const keyMatch = input.match(/^(\w+-\d+)$/);
    if (keyMatch) return keyMatch[1];
    return null;
}

function makeRequest(method, path, token, body) {
    return new Promise((resolve, reject) => {
        const headers = {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
            'User-Agent': 'Supermap-Jira-Labels/1.0',
        };
        if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
        }
        const req = https.request(
            {
                hostname: JIRA_BASE_URL,
                path,
                method,
                headers,
                timeout: 30000,
                rejectUnauthorized: false,
            },
            (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            resolve(data ? JSON.parse(data) : null);
                        } catch (e) {
                            reject(new Error(`响应解析失败: ${e.message}`));
                        }
                    } else if (res.statusCode === 401) {
                        reject(new Error('认证失败，请检查 SUPERMAP_JIRA_TOKEN'));
                    } else if (res.statusCode === 404) {
                        reject(new Error(`issue 不存在或无权访问 (HTTP 404): ${path}`));
                    } else if (res.statusCode === 400) {
                        reject(new Error(`请求无效 (HTTP 400): ${data || '无响应内容'}`));
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                    }
                });
            }
        );
        req.on('error', (err) => reject(new Error(`网络错误: ${err.message}`)));
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('请求超时'));
        });
        if (body !== undefined) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

async function getIssueLabels(issueKey, token) {
    const data = await makeRequest('GET', `/rest/api/2/issue/${issueKey}?fields=labels`, token);
    return data?.fields?.labels || [];
}

// Jira Server 无 /rest/api/2/labels 端点（404），改用 search 分页聚合全部标签
async function listAllLabels(token) {
    const labelCounts = new Map();
    const PAGE_SIZE = 1000;
    const jql = encodeURIComponent('labels is not EMPTY');
    let startAt = 0;
    let total = Infinity;
    while (startAt < total) {
        const data = await makeRequest(
            'GET',
            `/rest/api/2/search?jql=${jql}&fields=labels&maxResults=${PAGE_SIZE}&startAt=${startAt}`,
            token
        );
        total = data?.total ?? 0;
        for (const issue of data?.issues || []) {
            for (const label of issue.fields?.labels || []) {
                labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
            }
        }
        startAt += PAGE_SIZE;
    }
    if (labelCounts.size === 0) {
        console.log('暂无标签');
        return;
    }
    const sorted = [...labelCounts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [label] of sorted) {
        console.log(`• ${label}`);
    }
    console.log(`\n共 ${labelCounts.size} 个标签`);
}

async function updateLabel(issueKey, label, action, token) {
    const currentLabels = await getIssueLabels(issueKey, token);
    if (action === 'add' && currentLabels.includes(label)) {
        console.log(`ℹ️ 标签已存在: ${label}，无需重复添加`);
        return;
    }
    if (action === 'remove' && !currentLabels.includes(label)) {
        console.log(`ℹ️ 标签不存在: ${label}，无需移除`);
        return;
    }
    await makeRequest(
        'PUT',
        `/rest/api/2/issue/${issueKey}`,
        token,
        { update: { labels: [{ [action]: label }] } }
    );
    if (action === 'add') {
        console.log(`✅ 已为 ${issueKey} 添加标签: ${label}`);
    } else {
        console.log(`✅ 已从 ${issueKey} 移除标签: ${label}`);
    }
}

function printHelp() {
    console.log(`Supermap Jira 标签管理

用法:
  node manage_labels.js --list
  node manage_labels.js --add <Jira URL 或 Issue Key> <标签名>
  node manage_labels.js --remove <Jira URL 或 Issue Key> <标签名>

说明:
  --list    列出系统中所有标签
  --add     给 issue 添加标签（追加式，保留已有标签；已存在则幂等提示）
  --remove  从 issue 移除标签（标签不存在则幂等提示）

环境变量:
  SUPERMAP_JIRA_TOKEN  - 必需。Jira API 认证令牌。

示例:
  node manage_labels.js --list
  node manage_labels.js --add ISVJ-7734 explored
  node manage_labels.js --remove "https://jira.supermap.work/browse/ISVJ-7734" explored
`);
}

async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
        printHelp();
        process.exit(0);
    }

    const action = args[0];
    const token = getToken();

    if (action === '--list') {
        await listAllLabels(token);
        return;
    }

    if (action === '--add' || action === '--remove') {
        if (args.length < 3) {
            console.error(`Error: ${action} 需要 <Issue Key> 和 <标签名> 两个参数`);
            printHelp();
            process.exit(1);
        }
        const issueKey = parseIssueKey(args[1]);
        if (!issueKey) {
            console.error(`Error: 无法从 "${args[1]}" 解析 Issue Key`);
            process.exit(1);
        }
        const label = args[2].trim();
        if (!label) {
            console.error('Error: 标签名不能为空');
            process.exit(1);
        }
        await updateLabel(issueKey, label, action.slice(2), token);
        return;
    }

    console.error(`Error: 未知命令 "${action}"`);
    printHelp();
    process.exit(1);
}

main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
});
