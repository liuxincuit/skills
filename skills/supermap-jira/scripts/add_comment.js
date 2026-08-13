#!/usr/bin/env node
/**
 * Supermap Jira 添加评论脚本
 *
 * 用法:
 *   node add_comment.js <Jira URL 或 Issue Key> "<评论内容>"
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

function addComment(issueKey, body, token) {
    return new Promise((resolve, reject) => {
        const req = https.request(
            {
                hostname: JIRA_BASE_URL,
                path: `/rest/api/2/issue/${issueKey}/comment`,
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'User-Agent': 'Supermap-Jira-Comment/1.0',
                },
                timeout: 30000,
                rejectUnauthorized: false,
            },
            (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            resolve(JSON.parse(data));
                        } catch (e) {
                            reject(new Error(`响应解析失败: ${e.message}`));
                        }
                    } else if (res.statusCode === 401) {
                        reject(new Error('认证失败，请检查 SUPERMAP_JIRA_TOKEN'));
                    } else if (res.statusCode === 404) {
                        reject(new Error(`issue 不存在或无权访问 (HTTP 404): ${issueKey}`));
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
        req.write(JSON.stringify({ body }));
        req.end();
    });
}

function printHelp() {
    console.log(`Supermap Jira 添加评论

用法:
  node add_comment.js <Jira URL 或 Issue Key> "<评论内容>"

说明:
  给指定 issue 添加一条公开评论（与页面输入一致，无可见性限制）。

环境变量:
  SUPERMAP_JIRA_TOKEN  - 必需。Jira API 认证令牌。

示例:
  node add_comment.js ISVJ-7734 "已分析完成，结论: ..."
  node add_comment.js "https://jira.supermap.work/browse/ISVJ-7734" "多行内容可以用
换行符分隔"
`);
}

async function main() {
    const args = process.argv.slice(2);

    if (args.length < 2 || args[0] === '--help' || args[0] === '-h') {
        if (args[0] === '--help' || args[0] === '-h') {
            printHelp();
            process.exit(0);
        }
        console.error('Error: 需要 <Issue Key> 和 <评论内容> 两个参数');
        printHelp();
        process.exit(1);
    }

    const issueKey = parseIssueKey(args[0]);
    if (!issueKey) {
        console.error(`Error: 无法从 "${args[0]}" 解析 Issue Key`);
        process.exit(1);
    }

    const body = args.slice(1).join(' ').trim();
    if (!body) {
        console.error('Error: 评论内容不能为空');
        process.exit(1);
    }

    const token = getToken();
    const comment = await addComment(issueKey, body, token);
    console.log(`✅ 评论已添加: ${issueKey} (评论 ID: ${comment.id})`);
    console.log(`链接: https://jira.supermap.work/browse/${issueKey}`);
}

main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
});
