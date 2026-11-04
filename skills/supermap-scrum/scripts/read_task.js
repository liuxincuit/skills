#!/usr/bin/env node
/**
 * ISVS 任务详情查询工具
 * 使用: node read_task.js ISVS-1165 [--json] [--download [关键字]] [--download-dir <目录>]
 *
 * 环境变量:
 *   SUPERMAP_SCRUM_TOKEN     必需。REST API 认证令牌
 *   SUPERMAP_SCRUM_COOKIE    下载附件时可选。浏览器 Cookie 字符串
 *   SUPERMAP_SCRUM_USER      下载附件时可选。配合 PASSWORD 做表单登录
 *   SUPERMAP_SCRUM_PASSWORD  下载附件时可选
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const HOST = 'scrum.supermap.work';
const token = process.env.SUPERMAP_SCRUM_TOKEN;

if (!token) {
  console.error('❌ 请设置环境变量: export SUPERMAP_SCRUM_TOKEN=你的token');
  process.exit(1);
}

// ========== 参数解析 ==========
const rawArgs = process.argv.slice(2);
let issueKey = null;
let jsonMode = false;
let downloadMode = false;
let downloadPattern = null;
let downloadDir = process.cwd();

for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a === '--json') {
    jsonMode = true;
  } else if (a === '--download') {
    downloadMode = true;
    if (rawArgs[i + 1] && !rawArgs[i + 1].startsWith('--')) {
      downloadPattern = rawArgs[i + 1];
      i++;
    }
  } else if (a === '--download-dir') {
    if (rawArgs[i + 1]) {
      downloadDir = rawArgs[i + 1];
      i++;
    }
  } else if (issueKey === null) {
    issueKey = a;
  }
}

// 支持裸 key 和 browse URL 两种输入
const urlMatch = (issueKey || '').match(/browse\/([A-Z][A-Z0-9_]*-\d+)/i);
const keyMatch = (issueKey || '').match(/^([A-Z][A-Z0-9_]*-\d+)$/i);
issueKey = urlMatch ? urlMatch[1].toUpperCase() : keyMatch ? keyMatch[1].toUpperCase() : null;

if (!issueKey) {
  console.error('❌ 请提供 ISVS issue key，例如: node read_task.js ISVS-1165');
  process.exit(1);
}

function call(path) {
  return new Promise((resolve, reject) => {
    const u = new URL('https://' + HOST + path);
    const options = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    };
    const req = https.get(options, (res) => {
      // 必须显式设编码：否则分块切断多字节 UTF-8 字符会产生 U+FFFD 乱码
      res.setEncoding('utf8');
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

function fmt(s) {
  if (!s) return 'N/A';
  return new Date(s).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

/**
 * 验证会话 Cookie 是否真的已认证。
 * 用 /rest/auth/1/session 判断：已认证 200（带 username），未认证 401。
 * 注意不能用 /secure/Dashboard.jspa：它允许匿名访问，恒返 200。
 */
function validateSession(cookie) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: HOST,
      path: '/rest/auth/1/session',
      method: 'GET',
      headers: { 'Cookie': cookie, 'Accept': 'application/json' },
      timeout: 30000
    }, (res) => {
      res.setEncoding('utf8');
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          resolve(false);
          return;
        }
        try {
          resolve(Boolean(JSON.parse(data).name));
        } catch (e) {
          resolve(false);
        }
      });
    });
    req.on('error', e => reject(new Error(`会话验证请求失败: ${e.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('会话验证请求超时')); });
    req.end();
  });
}

/** 用用户名密码表单登录，换取 JSESSIONID */
function loginWithPassword(user, pass) {
  return new Promise((resolve, reject) => {
    const body = `os_username=${encodeURIComponent(user)}&os_password=${encodeURIComponent(pass)}&os_cookie=true`;
    const req = https.request({
      hostname: HOST,
      path: '/login.jsp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 30000
    }, (res) => {
      res.resume();
      res.on('end', () => {
        const setCookie = res.headers['set-cookie'] || [];
        const session = setCookie.find(c => c.startsWith('JSESSIONID='));
        if (!session) {
          reject(new Error('登录失败：服务端未返回 JSESSIONID'));
          return;
        }
        resolve(session.split(';')[0]);
      });
    });
    req.on('error', e => reject(new Error(`登录请求失败: ${e.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('登录请求超时')); });
    req.write(body);
    req.end();
  });
}

/**
 * 获取下载附件所需的会话 Cookie。
 * Jira Server 的 PAT 只对 /rest/ 生效，/secure/attachment/ 必须用会话认证，
 * 因此这里依赖 SUPERMAP_SCRUM_COOKIE 或 USER/PASSWORD 表单登录。
 */
async function getSessionCookie() {
  const cookie = process.env.SUPERMAP_SCRUM_COOKIE;
  if (cookie && cookie.trim()) {
    const trimmed = cookie.trim();
    if (!await validateSession(trimmed)) {
      throw new Error('SUPERMAP_SCRUM_COOKIE 已失效，请从浏览器重新复制完整 Cookie');
    }
    return trimmed;
  }

  const user = process.env.SUPERMAP_SCRUM_USER;
  const pass = process.env.SUPERMAP_SCRUM_PASSWORD;
  if (!user || !pass) {
    throw new Error(
      '下载附件需要会话认证（PAT 对 /secure/attachment 无效）。\n' +
      '  任选一种方式设置环境变量：\n' +
      '    1. export SUPERMAP_SCRUM_COOKIE="从浏览器复制完整 Cookie"\n' +
      '    2. export SUPERMAP_SCRUM_USER=liuxin1 SUPERMAP_SCRUM_PASSWORD=你的密码'
    );
  }

  const session = await loginWithPassword(user, pass);
  if (!await validateSession(session)) {
    throw new Error('表单登录失败：用户名或密码错误');
  }
  return session;
}

/** 下载单个附件到目录 */
function downloadAttachment(att, cookie, dir) {
  return new Promise((resolve, reject) => {
    if (!att.content) {
      reject(new Error(`附件 ${att.filename} 缺少下载 URL`));
      return;
    }
    const u = new URL(att.content);
    // 文件名可能含路径分隔符，取 basename 防止写出目标目录
    const safeName = path.basename(att.filename || `attachment-${att.id}`);
    const filePath = path.join(dir, safeName);

    const req = https.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { 'Cookie': cookie, 'Accept': '*/*' },
      timeout: 60000
    }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 401) {
        res.resume();
        const target = res.headers.location || '';
        reject(new Error(
          `无法下载 ${safeName}（HTTP ${res.statusCode}）。` +
          (target.includes('login.jsp') ? ' 会话已失效，请重新认证' : ` 跳转到: ${target}`)
        ));
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error(`下载失败 HTTP ${res.statusCode}: ${safeName}`));
        return;
      }
      const ws = fs.createWriteStream(filePath);
      res.pipe(ws);
      ws.on('finish', () => resolve({ filePath, size: att.size }));
      ws.on('error', err => reject(new Error(`写入失败: ${err.message}`)));
    });
    req.on('error', e => reject(new Error(`下载请求失败: ${e.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error(`下载超时: ${safeName}`)); });
    req.end();
  });
}

function fmtSize(bytes) {
  if (typeof bytes !== 'number') return 'N/A';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function main() {
  // ========== 数据收集 ==========

  // 1. 获取 issue 基本信息
  const r1 = await call(`/rest/api/2/issue/${issueKey}?fields=summary,priority,resolution,description,status,assignee,reporter,created,updated,resolutiondate,customfield_10624,attachment`);
  if (r1.status !== 200) {
    console.error(`\n❌ 查询失败: HTTP ${r1.status}`);
    console.error(JSON.stringify(r1.body).substring(0, 200));
    process.exit(1);
  }
  const f = r1.body.fields || {};

  // Sprint 信息
  const sprintField = f.customfield_10624;
  let sprintInfo = '';
  if (sprintField && sprintField.length > 0) {
    sprintInfo = sprintField.map(s => {
      const nameM = s.match(/name=([^,]+)/);
      const stateM = s.match(/state=([^,]+)/);
      const name = nameM ? nameM[1] : '';
      const state = stateM ? (stateM[1] === 'ACTIVE' ? '活跃' : stateM[1] === 'CLOSED' ? '已关闭' : stateM[1]) : '';
      return `${name} (${state})`;
    }).join(', ');
  }

  // 2. 获取 remote issue link (关联的 Jira 缺陷)
  let linkedIsvjUrl = '';
  const r2 = await call(`/rest/api/2/issue/${issueKey}/remotelink`);
  let hasLink = false;
  if (r2.status === 200 && Array.isArray(r2.body) && r2.body.length > 0) {
    for (const link of r2.body) {
      const url = link.object?.url || '';
      if (url) {
        linkedIsvjUrl = url;
        hasLink = true;
        break;
      }
    }
  }
  if (!hasLink) {
    const match = (f.summary || '').match(/(ISVJ-\d+)/);
    if (match) {
      linkedIsvjUrl = `https://jira.supermap.work/browse/${match[1]}`;
    }
  }

  // 提取 ISVJ key
  const isvjMatch = linkedIsvjUrl.match(/\/browse\/(ISVJ-\d+)/);
  const linkedIsvj = isvjMatch ? isvjMatch[1] : '';

  // 3. 附件清单
  const attachments = (f.attachment || []).map(a => ({
    id: a.id,
    filename: a.filename,
    size: a.size,
    mimeType: a.mimeType || '',
    created: a.created || '',
    author: a.author?.displayName || '',
    content: a.content || ''
  }));

  // 4. 获取注释
  const r3 = await call(`/rest/api/2/issue/${issueKey}/comment?orderBy=created`);
  const comments = [];
  if (r3.status === 200 && Array.isArray(r3.body.comments)) {
    for (const c of r3.body.comments) {
      comments.push({
        author: c.author?.displayName || 'N/A',
        authorName: c.author?.name || '',
        created: c.created || '',
        body: c.body || ''
      });
    }
  }

  // ========== JSON 模式 ==========
  if (jsonMode) {
    const result = {
      key: issueKey,
      summary: f.summary || '',
      status: f.status?.name || '',
      priority: f.priority?.name || '',
      resolution: f.resolution?.name || '',
      description: f.description || '',
      assignee: f.assignee?.displayName || '',
      reporter: f.reporter?.displayName || '',
      created: f.created || '',
      updated: f.updated || '',
      resolutiondate: f.resolutiondate || '',
      sprint: sprintInfo,
      linkedIsvj,
      linkedIsvjUrl,
      attachments,
      comments
    };
    console.log(JSON.stringify(result, null, 2));
    if (downloadMode) {
      console.error('⚠️  --json 模式下不执行附件下载，去掉 --json 后单独使用 --download');
    }
    return;
  }

  // ========== 格式化输出 ==========
  console.log('='.repeat(72));
  console.log(`🔍 ISVS 任务详情: ${issueKey}`);
  console.log('='.repeat(72));

  // 基本信息
  console.log(`\n📋 基本信息`);
  console.log(`  ${'─'.repeat(30)}`);
  console.log(`  标题:     ${f.summary || 'N/A'}`);
  console.log(`  状态:     ${f.status?.name || 'N/A'}`);
  console.log(`  优先级:   ${f.priority?.name || 'N/A'}`);
  console.log(`  解决结果: ${f.resolution?.name || '未解决'}`);
  console.log(`  负责人:   ${f.assignee?.displayName || '未分配'}`);
  console.log(`  报告人:   ${f.reporter?.displayName || 'N/A'}`);
  console.log(`  创建时间: ${fmt(f.created)}`);
  console.log(`  更新时间: ${fmt(f.updated)}`);
  if (f.resolutiondate) console.log(`  解决时间: ${fmt(f.resolutiondate)}`);

  // Sprint 信息
  if (sprintInfo) console.log(`  Sprint:   ${sprintInfo}`);

  // 关联的 Jira 缺陷
  console.log(`\n🔗 关联的 Jira 缺陷`);
  console.log(`  ${'─'.repeat(30)}`);
  if (linkedIsvjUrl) {
    console.log(`  ${linkedIsvjUrl}`);
  } else {
    console.log(`  (无关联的 Jira 缺陷)`);
  }

  // 描述
  console.log(`\n📝 描述`);
  console.log(`  ${'─'.repeat(30)}`);
  if (f.description) {
    console.log(`  ${f.description.replace(/\n/g, '\n  ')}`);
  } else {
    console.log(`  (无描述内容)`);
  }

  // 附件
  console.log(`\n📎 附件 (Attachments)`);
  console.log(`  ${'─'.repeat(30)}`);
  if (attachments.length > 0) {
    for (const a of attachments) {
      console.log(`  [${a.id}] ${a.filename}  ${fmtSize(a.size)}  ${a.mimeType}`);
      console.log(`     ${a.author}  ${fmt(a.created)}`);
    }
    console.log(`  ──────────────────────────────────`);
    console.log(`  共 ${attachments.length} 个附件`);
  } else {
    console.log(`  (无附件)`);
  }

  // 注释
  console.log(`\n💬 注释 (Comments)`);
  console.log(`  ${'─'.repeat(30)}`);
  if (comments.length > 0) {
    for (const c of comments) {
      console.log(`  ──────────────────────────────────`);
      console.log(`  ${c.author}  ${fmt(c.created)}`);
      console.log(`  ${c.body.replace(/\n/g, '\n  ')}`);
    }
    console.log(`  ──────────────────────────────────`);
    console.log(`  共 ${comments.length} 条注释`);
  } else {
    console.log(`  (无注释)`);
  }

  console.log('\n' + '='.repeat(72));

  // ========== 附件下载 ==========
  if (!downloadMode) return;

  console.log('\n⬇️  下载附件');
  console.log('  ' + '─'.repeat(30));

  if (attachments.length === 0) {
    console.log('  (无附件可下载)');
    return;
  }

  const targets = downloadPattern
    ? attachments.filter(a => a.filename.includes(downloadPattern))
    : attachments;

  if (targets.length === 0) {
    console.log(`  (没有文件名包含 "${downloadPattern}" 的附件)`);
    return;
  }

  fs.mkdirSync(downloadDir, { recursive: true });

  let cookie;
  try {
    cookie = await getSessionCookie();
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  for (const att of targets) {
    const safeName = path.basename(att.filename || `attachment-${att.id}`);
    const target = path.join(downloadDir, safeName);
    if (fs.existsSync(target)) {
      console.log(`  ⏭️  已存在，跳过: ${safeName}`);
      skipped++;
      continue;
    }
    try {
      const r = await downloadAttachment(att, cookie, downloadDir);
      console.log(`  ✅ ${safeName}  ${fmtSize(r.size)}  -> ${r.filePath}`);
      ok++;
    } catch (e) {
      console.error(`  ❌ ${safeName}: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n  完成: ${ok} 个下载成功，${skipped} 个跳过，${failed} 个失败`);
  console.log(`  目录: ${path.resolve(downloadDir)}`);
}

main().catch(e => console.error('❌', e.message));
