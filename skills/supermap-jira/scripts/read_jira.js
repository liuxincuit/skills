#!/usr/bin/env node

/**
 * Supermap Jira Read Script
 * 读取单个 Jira Issue 的详细信息
 */

const https = require('https');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

// 配置
const JIRA_BASE_URL = 'https://jira.supermap.work';
const TOKEN_ENV_VAR = 'SUPERMAP_JIRA_TOKEN';

/**
 * 从输入解析 Issue Key
 * @param {string} input - Jira URL 或 Issue Key
 * @returns {string|null} - Issue Key 或 null
 */
function parseIssueKey(input) {
    if (!input) return null;

    // 去除空白字符
    input = input.trim();

    // 如果是完整 URL，提取 issue key
    const urlMatch = input.match(/browse\/(\w+-\d+)/);
    if (urlMatch) {
        return urlMatch[1];
    }

    // 如果是纯 issue key 格式 (如 ISVJ-11474)
    const keyMatch = input.match(/^(\w+-\d+)$/);
    if (keyMatch) {
        return keyMatch[1];
    }

    return null;
}

/**
 * 获取环境变量中的 Token
 * @returns {string|null}
 */
function getToken() {
    return process.env[TOKEN_ENV_VAR] || null;
}

/**
 * 调用 Jira API 获取 Issue 详情
 * @param {string} issueKey - Issue Key
 * @param {string} token - 认证 Token
 * @returns {Promise<Object>}
 */
function fetchIssue(issueKey, token) {
    return new Promise((resolve, reject) => {
        const apiUrl = `${JIRA_BASE_URL}/rest/api/2/issue/${issueKey}`;
        const parsedUrl = url.parse(apiUrl);

        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: parsedUrl.path,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        };

        const client = parsedUrl.protocol === 'https:' ? https : http;

        const req = client.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    if (res.statusCode === 200) {
                        resolve(response);
                    } else {
                        reject(new Error(`API Error ${res.statusCode}: ${response.errorMessages?.join(', ') || data}`));
                    }
                } catch (e) {
                    reject(new Error(`Parse error: ${e.message}`));
                }
            });
        });

        req.on('error', (error) => {
            reject(new Error(`Request error: ${error.message}`));
        });

        req.setTimeout(30000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        req.end();
    });
}

/**
 * 格式化日期
 * @param {string} dateStr - ISO 日期字符串
 * @returns {string}
 */
function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    try {
        const date = new Date(dateStr);
        return date.toLocaleString('zh-CN');
    } catch (e) {
        return dateStr;
    }
}

/**
 * 格式化输出 Issue 详情
 * @param {Object} issue - Jira issue 对象
 */
function formatOutput(issue) {
    const fields = issue.fields || {};

    console.log('='.repeat(80));
    console.log(`🎫 Jira Issue: ${issue.key}`);
    console.log('='.repeat(80));

    // 基本信息
    console.log('\n📋 基本信息');
    console.log('-'.repeat(40));
    console.log(`标题:    ${fields.summary || 'N/A'}`);
    console.log(`类型:    ${fields.issuetype?.name || 'N/A'}`);
    console.log(`状态:    ${fields.status?.name || 'N/A'}`);
    console.log(`优先级:  ${fields.priority?.name || 'N/A'}`);
    console.log(`链接:    ${JIRA_BASE_URL}/browse/${issue.key}`);

    // 人员信息
    console.log('\n👥 人员信息');
    console.log('-'.repeat(40));
    console.log(`报告人:  ${fields.reporter?.displayName || 'N/A'} (${fields.reporter?.name || 'N/A'})`);
    console.log(`负责人:  ${fields.assignee?.displayName || '未分配'} (${fields.assignee?.name || 'N/A'})`);

    // 时间信息
    console.log('\n📅 时间信息');
    console.log('-'.repeat(40));
    console.log(`创建时间: ${formatDate(fields.created)}`);
    console.log(`更新时间: ${formatDate(fields.updated)}`);
    if (fields.resolutiondate) {
        console.log(`解决时间: ${formatDate(fields.resolutiondate)}`);
    }

    // 组件
    if (fields.components && fields.components.length > 0) {
        console.log('\n🔧 组件');
        console.log('-'.repeat(40));
        fields.components.forEach(comp => {
            console.log(`  • ${comp.name}`);
        });
    }

    // 版本
    if (fields.fixVersions && fields.fixVersions.length > 0) {
        console.log('\n📌 修复版本');
        console.log('-'.repeat(40));
        fields.fixVersions.forEach(ver => {
            console.log(`  • ${ver.name}`);
        });
    }

    if (fields.versions && fields.versions.length > 0) {
        console.log('\n🏷️ 影响版本');
        console.log('-'.repeat(40));
        fields.versions.forEach(ver => {
            console.log(`  • ${ver.name}`);
        });
    }

    // 描述
    if (fields.description) {
        console.log('\n📝 描述');
        console.log('-'.repeat(40));
        console.log(fields.description);
    }

    // 自定义字段 - 缺陷详情（Supermap Jira使用自定义字段存储）
    const hasCustomFields = fields.customfield_10040 || fields.customfield_10043 || fields.customfield_10042;

    if (!fields.description && hasCustomFields) {
        console.log('\n📝 描述');
        console.log('-'.repeat(40));
        console.log('(标准描述字段为空，详细信息见下方)');
    }

    if (hasCustomFields) {
        console.log('\n📋 缺陷详情');
        console.log('-'.repeat(40));

        if (fields.customfield_10040) {
            console.log('\n【重现步骤】');
            console.log(safeDecodeURIComponent(fields.customfield_10040));
        }

        if (fields.customfield_10043) {
            console.log('\n【详细描述】');
            console.log(safeDecodeURIComponent(fields.customfield_10043));
        }

        if (fields.customfield_10042) {
            console.log('\n【测试环境】');
            console.log(fields.customfield_10042);
        }
    }

    // 附件
    if (fields.attachment && fields.attachment.length > 0) {
        console.log('\n📎 附件');
        console.log('-'.repeat(40));
        fields.attachment.forEach(att => {
            console.log(`  • ${att.filename} (${formatFileSize(att.size)})`);
            if (att.content) {
                console.log(`    下载: ${att.content}`);
            }
        });
    }

    // 标签
    if (fields.labels && fields.labels.length > 0) {
        console.log('\n🏷️ 标签');
        console.log('-'.repeat(40));
        console.log(`  ${fields.labels.join(', ')}`);
    }

    // 评论
    if (fields.comment && fields.comment.comments && fields.comment.comments.length > 0) {
        console.log('\n💬 评论');
        console.log('-'.repeat(40));
        console.log(`评论总数: ${fields.comment.comments.length}`);
        fields.comment.comments.forEach((comment, index) => {
            console.log(`\n--- 评论 ${index + 1} ---`);
            console.log(`作者: ${comment.author?.displayName || 'N/A'} (${comment.author?.name || 'N/A'})`);
            console.log(`时间: ${formatDate(comment.created)}`);
            console.log('内容:');
            console.log(comment.body || '(空)');
        });
    }

    console.log('\n' + '='.repeat(80));
}

/**
 * 格式化文件大小
 * @param {number} bytes
 * @returns {string}
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 安全解码URI组件
 * @param {string} str
 * @returns {string}
 */
function safeDecodeURIComponent(str) {
    if (!str) return str;
    try {
        return decodeURIComponent(str);
    } catch (e) {
        return str;
    }
}

/**
 * 下载附件
 * @param {Object} att - 附件对象（含 content 下载 URL）
 * @param {string} token - 认证 Token
 * @param {string} dir - 保存目录
 * @returns {Promise<string>} 保存的文件路径
 */
function downloadAttachment(att, token, dir) {
    return new Promise((resolve, reject) => {
        if (!att.content) {
            reject(new Error(`附件 ${att.filename} 缺少下载 URL`));
            return;
        }
        const parsedUrl = url.parse(att.content);
        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: parsedUrl.path,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        };
        const client = parsedUrl.protocol === 'https:' ? https : http;
        const filePath = path.join(dir, att.filename);
        const req = client.request(options, (res) => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                const ws = fs.createWriteStream(filePath);
                res.pipe(ws);
                ws.on('finish', () => resolve(filePath));
                ws.on('error', (err) => reject(err));
            } else {
                res.resume();
                reject(new Error(`下载失败 HTTP ${res.statusCode}: ${att.filename}`));
            }
        });
        req.on('error', (error) => reject(new Error(`下载请求失败: ${error.message}`)));
        req.setTimeout(60000, () => {
            req.destroy();
            reject(new Error(`下载超时: ${att.filename}`));
        });
        req.end();
    });
}

/**
 * 主函数
 */
async function main() {
    try {
        // 解析命令行参数：node read_jira.js <input> [--json] [--download [pattern]] [--download-dir <dir>]
        const args = process.argv.slice(2);
        let input = null;
        let jsonMode = false;
        let downloadMode = false;
        let downloadPattern = null;
        let downloadDir = process.cwd();

        for (let i = 0; i < args.length; i++) {
            const a = args[i];
            if (a === '--json') {
                jsonMode = true;
            } else if (a === '--download') {
                downloadMode = true;
                if (args[i + 1] && !args[i + 1].startsWith('--')) {
                    downloadPattern = args[i + 1];
                    i++;
                }
            } else if (a === '--download-dir') {
                if (args[i + 1]) {
                    downloadDir = args[i + 1];
                    i++;
                }
            } else if (input === null) {
                input = a;
            }
        }

        if (!input) {
            console.error('❌ 错误: 请提供 Jira URL 或 Issue Key');
            console.log('\n使用方法:');
            console.log('  node read_jira.js ISVJ-11474');
            console.log('  node read_jira.js ISVJ-11474 --json');
            console.log('  node read_jira.js ISVJ-11474 --download');
            console.log('  node read_jira.js ISVJ-11474 --download "截图"');
            console.log('  node read_jira.js ISVJ-11474 --download --download-dir ./attachments');
            console.log('  node read_jira.js "http://jira.ispeco.com:8090/browse/ISVJ-11474"');
            process.exit(1);
        }

        // 解析 Issue Key
        const issueKey = parseIssueKey(input);
        if (!issueKey) {
            console.error('❌ 错误: 无法解析 Issue Key，请检查输入格式');
            console.log('\n支持的格式:');
            console.log('  - ISVJ-11474');
            console.log('  - http://jira.ispeco.com:8090/browse/ISVJ-11474');
            process.exit(1);
        }

        // 获取 Token
        const token = getToken();
        if (!token) {
            console.error(`❌ 错误: 未设置环境变量 ${TOKEN_ENV_VAR}`);
            console.log('\n请设置环境变量:');
            console.log(`  Windows: set ${TOKEN_ENV_VAR}=your_token`);
            console.log(`  Linux/Mac: export ${TOKEN_ENV_VAR}=your_token`);
            process.exit(1);
        }

        // 调用 API
        const issue = await fetchIssue(issueKey, token);

        // 下载模式
        if (downloadMode) {
            const attachments = (issue.fields?.attachment) || [];
            if (attachments.length === 0) {
                console.log(`ℹ️ Issue ${issueKey} 没有附件`);
                return;
            }
            const targets = downloadPattern
                ? attachments.filter(att => att.filename.includes(downloadPattern))
                : attachments;
            if (targets.length === 0) {
                console.log(`ℹ️ 没有文件名包含 "${downloadPattern}" 的附件`);
                return;
            }
            if (!fs.existsSync(downloadDir)) {
                fs.mkdirSync(downloadDir, { recursive: true });
            }
            console.log(`⬇️ 正在下载 ${targets.length} 个附件到 ${downloadDir} ...`);
            let successCount = 0;
            for (const att of targets) {
                try {
                    const filePath = await downloadAttachment(att, token, downloadDir);
                    console.log(`  ✅ ${att.filename} -> ${filePath}`);
                    successCount++;
                } catch (e) {
                    console.error(`  ❌ ${att.filename}: ${e.message}`);
                }
            }
            console.log(`\n下载完成: ${successCount}/${targets.length}`);
            return;
        }

        // JSON 模式
        if (jsonMode) {
            const fields = issue.fields || {};
            const result = {
                key: issue.key,
                url: `${JIRA_BASE_URL}/browse/${issue.key}`,
                summary: fields.summary || '',
                issuetype: fields.issuetype?.name || '',
                status: fields.status?.name || '',
                priority: fields.priority?.name || '',
                resolution: fields.resolution?.name || '',
                description: fields.description || '',
                reporter: {
                    name: fields.reporter?.name || '',
                    displayName: fields.reporter?.displayName || ''
                },
                assignee: {
                    name: fields.assignee?.name || '',
                    displayName: fields.assignee?.displayName || ''
                },
                created: fields.created || '',
                updated: fields.updated || '',
                resolutiondate: fields.resolutiondate || '',
                components: (fields.components || []).map(c => c.name),
                fixVersions: (fields.fixVersions || []).map(v => v.name),
                affectedVersions: (fields.versions || []).map(v => v.name),
                labels: fields.labels || [],
                customFields: {
                    customfield_10040: fields.customfield_10040 || '',
                    customfield_10043: fields.customfield_10043 || '',
                    customfield_10042: fields.customfield_10042 || ''
                },
                attachments: (fields.attachment || []).map(a => ({
                    filename: a.filename,
                    size: a.size,
                    mimeType: a.mimeType,
                    content: a.content || ''
                })),
                comments: (fields.comment?.comments || []).map(c => ({
                    author: {
                        name: c.author?.name || '',
                        displayName: c.author?.displayName || ''
                    },
                    created: c.created || '',
                    body: c.body || ''
                }))
            };
            console.log(JSON.stringify(result, null, 2));
            return;
        }

        console.log(`🔍 正在查询 Issue: ${issueKey}...\n`);

        // 格式化输出
        formatOutput(issue);

    } catch (error) {
        console.error(`\n❌ ${error.message}`);
        process.exit(1);
    }
}

// 运行主函数
main();
