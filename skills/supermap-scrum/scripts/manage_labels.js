#!/usr/bin/env node
/**
 * Scrum 标签管理工具
 *
 * 用法:
 *   node manage_labels.js --list
 *   node manage_labels.js --show <ISVS Key>
 *   node manage_labels.js --add <ISVS Key> <标签名>
 *   node manage_labels.js --remove <ISVS Key> <标签名>
 *
 * 环境变量: SUPERMAP_SCRUM_TOKEN
 */

const https = require('https');
const HOST = 'scrum.supermap.work';
const token = process.env.SUPERMAP_SCRUM_TOKEN;

if (!token) {
  console.error('❌ 请设置环境变量: export SUPERMAP_SCRUM_TOKEN=你的token');
  process.exit(1);
}

const PAGE_SIZE = 1000;

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

/** 从 URL 或裸 key 中解析 issue key */
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
  if (status === 403) return '权限不足，当前账号无权执行该操作';
  if (status === 404) return 'issue 不存在或无权访问';
  if (status === 400) return `请求无效: ${String(raw).substring(0, 300)}`;
  return `HTTP ${status}: ${String(raw).substring(0, 300)}`;
}

/** 获取单个 issue 的标签 */
async function getIssueLabels(issueKey) {
  const r = await call('GET', `/rest/api/2/issue/${issueKey}?fields=labels`);
  if (r.status !== 200) throw new Error(explainError(r.status, r.raw));
  return r.body.fields?.labels || [];
}

/**
 * 全量列举标签。
 * Jira Server 没有 /rest/api/2/labels 端点，用 search 分页聚合 labels 字段。
 * 先用首页拿 total，再并行拉剩余页，避免串行翻页的长时间等待。
 */
async function listAllLabels() {
  const counts = new Map();
  const jql = encodeURIComponent('labels is not EMPTY');
  const buildPath = (startAt) =>
    `/rest/api/2/search?jql=${jql}&fields=labels&maxResults=${PAGE_SIZE}&startAt=${startAt}`;

  // 全量扫描需要多次请求，先给个反馈避免看起来卡住
  if (process.stderr.isTTY) process.stderr.write('正在扫描带标签的任务...\n');

  const first = await call('GET', buildPath(0));
  if (first.status !== 200) throw new Error(explainError(first.status, first.raw));

  const total = first.body.total ?? 0;
  const pages = [first.body.issues || []];

  if (total > PAGE_SIZE) {
    const rest = [];
    for (let startAt = PAGE_SIZE; startAt < total; startAt += PAGE_SIZE) {
      rest.push(call('GET', buildPath(startAt)).then(r => {
        if (r.status !== 200) throw new Error(explainError(r.status, r.raw));
        return r.body.issues || [];
      }));
    }
    pages.push(...await Promise.all(rest));
  }

  for (const issues of pages) {
    for (const issue of issues) {
      for (const label of issue.fields?.labels || []) {
        counts.set(label, (counts.get(label) || 0) + 1);
      }
    }
  }

  if (counts.size === 0) {
    console.log('暂无标签');
    return;
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`📋 系统标签（按使用次数降序，扫描 ${total} 个 issue）\n`);  for (const [label, count] of sorted) {
    console.log(`  ${label}  (${count})`);
  }
  console.log(`\n共 ${counts.size} 个标签`);
}

/** 显示单个 issue 的标签 */
async function showLabels(issueKey) {
  const labels = await getIssueLabels(issueKey);
  if (labels.length === 0) {
    console.log(`${issueKey} 暂无标签`);
    return;
  }
  console.log(`🏷️  ${issueKey} 的标签 (${labels.length}):\n`);
  for (const label of labels) console.log(`  ${label}`);
}

/** 增删标签，幂等处理 */
async function updateLabel(issueKey, label, action) {
  const current = await getIssueLabels(issueKey);

  if (action === 'add' && current.includes(label)) {
    console.log(`ℹ️ 标签已存在: ${label}，无需重复添加`);
    return;
  }
  if (action === 'remove' && !current.includes(label)) {
    console.log(`ℹ️ 标签不存在: ${label}，无需移除`);
    return;
  }

  // 用 update 语义而非 fields 覆盖，避免抹掉并发修改的其他标签
  const r = await call('PUT', `/rest/api/2/issue/${issueKey}`, {
    update: { labels: [{ [action]: label }] }
  });
  if (r.status !== 204 && r.status !== 200) {
    throw new Error(explainError(r.status, r.raw));
  }

  const verb = action === 'add' ? '添加' : '移除';
  console.log(`✅ 已为 ${issueKey} ${verb}标签: ${label}`);

  const after = await getIssueLabels(issueKey);
  console.log(`   当前标签: ${after.length > 0 ? after.join(', ') : '(无)'}`);
}

function printHelp() {
  console.log(`Scrum 标签管理

用法:
  node manage_labels.js --list
  node manage_labels.js --show <ISVS Key 或 URL>
  node manage_labels.js --add <ISVS Key 或 URL> <标签名>
  node manage_labels.js --remove <ISVS Key 或 URL> <标签名>

说明:
  --list     列出系统中所有标签（按使用次数降序）
  --show     显示单个任务的标签
  --add      添加标签（追加式，保留已有标签；已存在则幂等提示）
  --remove   移除标签（不存在则幂等提示）

环境变量:
  SUPERMAP_SCRUM_TOKEN  必需。Scrum API 认证令牌。

示例:
  node manage_labels.js --list
  node manage_labels.js --show ISVS-1513
  node manage_labels.js --add ISVS-1513 explored
  node manage_labels.js --remove "https://scrum.supermap.work/browse/ISVS-1513" explored
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    process.exit(0);
  }

  const action = args[0];

  if (action === '--list') {
    await listAllLabels();
    return;
  }

  if (action === '--show') {
    const key = parseIssueKey(args[1]);
    if (!key) {
      console.error('❌ 无法解析 issue key，请提供 ISVS-XXXX 或任务 URL');
      process.exit(1);
    }
    await showLabels(key);
    return;
  }

  if (action === '--add' || action === '--remove') {
    if (args.length < 3) {
      console.error(`❌ ${action} 需要 <ISVS Key> 和 <标签名> 两个参数`);
      printHelp();
      process.exit(1);
    }
    const key = parseIssueKey(args[1]);
    if (!key) {
      console.error(`❌ 无法从 "${args[1]}" 解析 issue key`);
      process.exit(1);
    }
    const label = args[2].trim();
    if (!label) {
      console.error('❌ 标签名不能为空');
      process.exit(1);
    }
    // Jira 标签不允许空格，提前拦截避免 400
    if (/\s/.test(label)) {
      console.error(`❌ 标签名不能包含空格: "${label}"`);
      process.exit(1);
    }
    await updateLabel(key, label, action.slice(2));
    return;
  }

  console.error(`❌ 未知命令 "${action}"`);
  printHelp();
  process.exit(1);
}

main().catch(e => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
