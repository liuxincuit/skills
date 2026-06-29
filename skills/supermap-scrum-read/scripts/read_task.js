#!/usr/bin/env node
/**
 * ISVS 任务详情查询工具
 * 使用: node isvs_detail.js ISVS-1165
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

const issueKey = process.argv[2];
if (!issueKey || !/^[A-Z]+-\d+$/.test(issueKey)) {
  console.error('❌ 请提供 ISVS issue key，例如: node isvs_detail.js ISVS-1165');
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

async function main() {
  console.log('='.repeat(72));
  console.log(`🔍 ISVS 任务详情: ${issueKey}`);
  console.log('='.repeat(72));

  // 1. 获取 issue 基本信息
  const r1 = await call(`/rest/api/2/issue/${issueKey}?fields=summary,priority,resolution,description,status,assignee,reporter,created,updated,resolutiondate,customfield_10624`);

  if (r1.status !== 200) {
    console.error(`\n❌ 查询失败: HTTP ${r1.status}`);
    console.error(JSON.stringify(r1.body).substring(0, 200));
    process.exit(1);
  }

  const f = r1.body.fields || {};

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
  const sprintField = f.customfield_10624;
  if (sprintField && sprintField.length > 0) {
    const sprintInfo = sprintField.map(s => {
      const nameM = s.match(/name=([^,]+)/);
      const stateM = s.match(/state=([^,]+)/);
      const name = nameM ? nameM[1] : '';
      const state = stateM ? (stateM[1] === 'ACTIVE' ? '活跃' : stateM[1] === 'CLOSED' ? '已关闭' : stateM[1]) : '';
      return `${name} (${state})`;
    }).join(', ');
    if (sprintInfo) console.log(`  Sprint:   ${sprintInfo}`);
  }

  // 2. 获取 remote issue link (关联的 Jira 缺陷)
  console.log(`\n🔗 关联的 Jira 缺陷`);
  console.log(`  ${'─'.repeat(30)}`);
  const r2 = await call(`/rest/api/2/issue/${issueKey}/remotelink`);
  let linked = false;
  if (r2.status === 200 && Array.isArray(r2.body) && r2.body.length > 0) {
    for (const link of r2.body) {
      const url = link.object?.url || '';
      const title = link.object?.title || '';
      const rel = link.relationship || '';
      if (url) {
        console.log(`  ${url}`);
        console.log(`  关系: ${rel} | 标题: ${title}`);
        linked = true;
      }
    }
  }
  if (!linked) {
    // fallback: 从标题提取
    const match = (f.summary || '').match(/(ISVJ-\d+)/);
    if (match) {
      console.log(`  https://jira.supermap.work/browse/${match[1]} (从标题提取)`);
    } else {
      console.log(`  (无关联的 Jira 缺陷)`);
    }
  }

  // 3. 描述
  console.log(`\n📝 描述`);
  console.log(`  ${'─'.repeat(30)}`);
  if (f.description) {
    console.log(`  ${f.description.replace(/\n/g, '\n  ')}`);
  } else {
    console.log(`  (无描述内容)`);
  }

  // 4. 注释
  console.log(`\n💬 注释 (Comments)`);
  console.log(`  ${'─'.repeat(30)}`);
  const r3 = await call(`/rest/api/2/issue/${issueKey}/comment?orderBy=created`);
  if (r3.status === 200 && Array.isArray(r3.body.comments) && r3.body.comments.length > 0) {
    for (const c of r3.body.comments) {
      console.log(`  ──────────────────────────────────`);
      console.log(`  ${c.author?.displayName || 'N/A'}  ${fmt(c.created)}`);
      const body = c.body || '';
      console.log(`  ${body.replace(/\n/g, '\n  ')}`);
    }
    console.log(`  ──────────────────────────────────`);
    console.log(`  共 ${r3.body.comments.length} 条注释`);
  } else {
    console.log(`  (无注释)`);
  }

  console.log('\n' + '='.repeat(72));
}

main().catch(e => console.error('❌', e.message));
