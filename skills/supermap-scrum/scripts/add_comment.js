#!/usr/bin/env node
/**
 * Scrum 添加评论工具
 *
 * 用法:
 *   node add_comment.js <ISVS Key 或 URL> "<评论内容>"
 *   node add_comment.js <ISVS Key 或 URL> --file <文件路径>
 *   echo "内容" | node add_comment.js <ISVS Key 或 URL> -
 *
 * 环境变量: SUPERMAP_SCRUM_TOKEN
 */

const https = require('https');
const fs = require('fs');
const HOST = 'scrum.supermap.work';
const token = process.env.SUPERMAP_SCRUM_TOKEN;

if (!token) {
  console.error('❌ 请设置环境变量: export SUPERMAP_SCRUM_TOKEN=你的token');
  process.exit(1);
}

function call(method, path, body) {
  return new Promise((resolve, reject) => {
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const req = https.request({
      hostname: HOST,
      path,
      method,
      headers,
      timeout: 30000
    }, (res) => {
      // 必须显式设编码，否则分块切断多字节 UTF-8 字符会产生乱码
      res.setEncoding('utf8');
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let parsed = data;
        try { if (data) parsed = JSON.parse(data); } catch (e) { /* 保留原始文本 */ }
        resolve({ status: res.statusCode, body: parsed, raw: data });
      });
    });
    req.on('error', e => reject(new Error(`网络错误: ${e.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

function parseIssueKey(input) {
  if (!input) return null;
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/browse\/([A-Z][A-Z0-9_]*-\d+)/i);
  if (urlMatch) return urlMatch[1].toUpperCase();
  const keyMatch = trimmed.match(/^([A-Z][A-Z0-9_]*-\d+)$/i);
  if (keyMatch) return keyMatch[1].toUpperCase();
  return null;
}

function explainError(status, raw) {
  if (status === 401) return '认证失败，请检查 SUPERMAP_SCRUM_TOKEN 是否有效';
  if (status === 403) return '权限不足，当前账号无权在该任务下评论';
  if (status === 404) return 'issue 不存在或无权访问';
  if (status === 400) return `请求无效: ${String(raw).substring(0, 300)}`;
  return `HTTP ${status}: ${String(raw).substring(0, 300)}`;
}

function printHelp() {
  console.log(`Scrum 添加评论

用法:
  node add_comment.js <ISVS Key 或 URL> "<评论内容>"
  node add_comment.js <ISVS Key 或 URL> --file <文件路径>
  echo "内容" | node add_comment.js <ISVS Key 或 URL> -

说明:
  评论内容支持 Jira wiki 标记（*加粗*、-删除线-、h3. 标题、{code}...{code} 等）。

环境变量:
  SUPERMAP_SCRUM_TOKEN  必需。Scrum API 认证令牌。

示例:
  node add_comment.js ISVS-1513 "已复现，环境 iServer 11.2.0"
  node add_comment.js ISVS-1513 --file ./note.md
  echo "单行说明" | node add_comment.js ISVS-1513 -
`);
}

/** 从 stdin 读取全部内容 */
function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => data += c);
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function fmt(s) {
  if (!s) return 'N/A';
  return new Date(s).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    process.exit(0);
  }

  const jsonMode = args.includes('--json');
  const fileIdx = args.indexOf('--file');

  // 第一个非选项参数是 issue key
  const positional = args.filter((a, i) => {
    if (a === '--json') return false;
    if (a === '--file' || i === fileIdx) return false;
    return !a.startsWith('--');
  });

  const issueKey = parseIssueKey(positional[0]);
  if (!issueKey) {
    console.error('❌ 无法解析 issue key，请提供 ISVS-XXXX 或任务 URL');
    printHelp();
    process.exit(1);
  }

  // 评论内容来源：--file > "-"（stdin）> 位置参数
  let body = '';
  if (fileIdx !== -1) {
    const filePath = args[fileIdx + 1];
    if (!filePath) {
      console.error('❌ --file 需要文件路径参数');
      process.exit(1);
    }
    if (!fs.existsSync(filePath)) {
      console.error(`❌ 文件不存在: ${filePath}`);
      process.exit(1);
    }
    body = fs.readFileSync(filePath, 'utf8');
  } else if (positional[1] === '-') {
    body = await readStdin();
  } else if (positional[1]) {
    body = positional[1];
  }

  if (!body.trim()) {
    console.error('❌ 评论内容不能为空');
    printHelp();
    process.exit(1);
  }

  const r = await call('POST', `/rest/api/2/issue/${issueKey}/comment`, { body });
  if (r.status !== 201) {
    throw new Error(explainError(r.status, r.raw));
  }

  if (jsonMode) {
    console.log(JSON.stringify({
      key: issueKey,
      commentId: r.body.id || '',
      author: r.body.author?.displayName || '',
      created: r.body.created || '',
      url: `https://${HOST}/browse/${issueKey}?focusedCommentId=${r.body.id || ''}`
    }, null, 2));
    return;
  }

  console.log(`✅ 已为 ${issueKey} 添加评论`);
  console.log(`  评论 ID: ${r.body.id || 'N/A'}`);
  console.log(`  作者:    ${r.body.author?.displayName || 'N/A'}`);
  console.log(`  时间:    ${fmt(r.body.created)}`);
  console.log(`  链接:    https://${HOST}/browse/${issueKey}?focusedCommentId=${r.body.id || ''}`);
}

main().catch(e => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
