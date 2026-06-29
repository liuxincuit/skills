#!/usr/bin/env node
/**
 * ISVS Scrum 活动日志查询工具
 * 使用:
 *   node isvs_activity.js                                                   # 默认最近7天
 *   node isvs_activity.js --since 2026-03-01 --until 2026-06-29             # 指定时间段
 *   node isvs_activity.js --since 2026-06-01                                # 指定开始日期
 *   node isvs_activity.js --status '处理中'                                  # 按状态过滤
 *   node isvs_activity.js --status '处理中,已完成,已验收'                    # 多个状态
 *                                                                           # 默认: 处理中,已完成,已验收
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

// ===== 参数解析 =====
const args = process.argv.slice(2);
const untilDefault = (() => { return new Date().toISOString().substring(0, 10); })();
const since = args.includes('--since') ? args[args.indexOf('--since') + 1] : (() => {
  const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().substring(0, 10);
})();
const until = args.includes('--until') ? args[args.indexOf('--until') + 1] : untilDefault;
const username = args.includes('--user') ? args[args.indexOf('--user') + 1] : 'liuxin1';
const statusFilter = args.includes('--status') ? args[args.indexOf('--status') + 1] : '处理中,已完成,已验收';

// ===== HTTP 工具 =====
function call(path) {
  return new Promise((resolve, reject) => {
    const u = new URL('https://' + HOST + path);
    const options = {
      hostname: u.hostname, port: u.port,
      path: u.pathname + u.search,
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
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
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

function fmtTime(s) {
  if (!s) return '';
  return new Date(s).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' });
}
function fmtDate(s) {
  if (!s) return '';
  return new Date(s).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

function inRange(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const end = new Date(until + 'T23:59:59');
  return d >= new Date(since) && d <= end;
}

// ===== 获取 task 详情（复用脚本1逻辑，纯数据返回） =====
async function getTaskDetail(key) {
  const r = await call(`/rest/api/2/issue/${key}?fields=summary,priority,resolution,description,status,assignee,reporter,created,updated,resolutiondate,customfield_10624`);
  if (r.status !== 200) return null;
  const f = r.body.fields || {};

  // 关联 ISVJ
  let linkedIsvj = null;
  const r2 = await call(`/rest/api/2/issue/${key}/remotelink`);
  if (r2.status === 200 && Array.isArray(r2.body) && r2.body.length > 0) {
    const url = r2.body[0].object?.url || '';
    const m = url.match(/\/browse\/(ISVJ-\d+)/);
    if (m) linkedIsvj = m[1];
  }
  if (!linkedIsvj) {
    const m = (f.summary || '').match(/(ISVJ-\d+)/);
    if (m) linkedIsvj = m[1];
  }

  // Sprint
  let sprint = '';
  const sf = f.customfield_10624;
  if (sf && sf.length > 0) {
    const nameM = sf[0].match(/name=([^,]+)/);
    if (nameM) sprint = nameM[1];
  }

  // 最近一条 comment
  let lastComment = null;
  const r3 = await call(`/rest/api/2/issue/${key}/comment?orderBy=created&maxResults=1`);
  if (r3.status === 200 && r3.body.comments?.length > 0) {
    const c = r3.body.comments[r3.body.comments.length - 1];
    lastComment = {
      author: c.author?.displayName || '',
      created: c.created || '',
      body: (c.body || '').substring(0, 100)
    };
  }

  return {
    key,
    summary: f.summary || '',
    status: f.status?.name || '',
    priority: f.priority?.name || '',
    resolution: f.resolution?.name || '',
    description: f.description || '',
    assignee: f.assignee?.displayName || '',
    reporter: f.reporter?.displayName || '',
    created: f.created || '',
    updated: f.updated || '',
    sprint,
    linkedIsvj,
    lastComment
  };
}

// ===== 格式化 changelog 变更项 =====
function formatItems(items) {
  return items.map(i => {
    const from = i.fromString || '', to = i.toString || '';
    if (i.field === 'status') return `状态: ${from} → ${to}`;
    if (i.field === 'assignee') return `负责人: ${from || '无'} → ${to || '无'}`;
    if (i.field === 'Sprint') return `Sprint 变更`;
    if (i.field === 'Rank') return null;
    if (i.field === 'resolution') return `解决结果: ${from || ''} → ${to || ''}`;
    if (i.fieldName === 'timeestimate' || i.fieldName === 'timeoriginalestimate') return null;
    if (i.field === 'Attachment') return `附件`;
    return `${i.fieldName || i.field}: ${from ? from.substring(0, 20) : ''} → ${to ? to.substring(0, 20) : ''}`;
  }).filter(Boolean).join('; ');
}

// ===== 主逻辑 =====
async function main() {
  console.log('='.repeat(72));
  console.log(`📋 ISVS Scrum 活动日志`);
  console.log(`   用户: ${username}  时间: ${since} ~ ${until}`);
  console.log('='.repeat(72));

  // ---- 第1步: 搜索该用户在该时间段的 issue ----
  console.log(`\n🔍 搜索 ${since} ~ ${until} 的活动...`);
  const statuses = statusFilter.split(',').map(s => `"${s.trim()}"`).join(', ');
  const jql = `assignee was "${username}" AND status in (${statuses}) AND updated >= "${since}" AND updated <= "${until}" ORDER BY updated DESC`;
  const search = await call(`/rest/api/2/search?jql=${encodeURIComponent(jql)}&maxResults=100&fields=summary,status,assignee,updated`);

  if (search.status !== 200) {
    console.error(`❌ 搜索失败: ${JSON.stringify(search.body).substring(0, 200)}`);
    process.exit(1);
  }

  const issues = search.body.issues || [];
  if (issues.length === 0) {
    console.log('   没有找到活动记录。\n');
    process.exit(0);
  }
  console.log(`   找到 ${search.body.total} 个 ISVS 任务\n`);

  // ---- 第2步: 获取每个任务的 changelog 和详情 ----
  console.log('⏳ 正在获取活动详情...\n');
  const allActivities = [];
  const taskDetails = [];

  for (let i = 0; i < issues.length; i++) {
    const key = issues[i].key;
    process.stdout.write(`\r   [${i + 1}/${issues.length}] ${key}`);

    // 获取 changelog
    const r = await call(`/rest/api/2/issue/${key}?expand=changelog&fields=summary&changelog.maxResults=500`);
    if (r.status === 200) {
      const histories = r.body.changelog?.histories || [];
      for (const h of histories) {
        if (h.author?.name === username && inRange(h.created)) {
          const detail = formatItems(h.items || []);
          if (detail) {
            allActivities.push({
              time: h.created,
              key,
              detail,
              author: h.author.displayName
            });
          }
        }
      }
    }

    // 获取详细数据（延迟获取，避免批处理时占用太多连接）
    const detail = await getTaskDetail(key);
    if (detail) taskDetails.push(detail);
  }

  process.stdout.write('\n');

  // ---- 第3步: 按时间输出活动日志 ----
  allActivities.sort((a, b) => new Date(b.time) - new Date(a.time));

  console.log(`📊 共 ${allActivities.length} 条操作记录\n`);
  if (allActivities.length > 0) {
    let currentDate = '';
    let shownCount = 0;
    for (const act of allActivities) {
      if (shownCount >= 100) { console.log('  ...(更多略)'); break; }
      const day = fmtDate(act.time);
      if (day !== currentDate) {
        console.log(`\n${day}`);
        currentDate = day;
      }
      console.log(`  ${fmtTime(act.time)} ${act.key}`);
      console.log(`    → ${act.detail}`);
      shownCount++;
    }
  }

  // ---- 第4步: 任务列表 ----
  console.log(`\n${'='.repeat(72)}`);
  console.log(`📋 任务列表 (${taskDetails.length} 个)`);
  console.log('='.repeat(72));

  taskDetails.sort((a, b) => new Date(b.updated) - new Date(a.updated));

  for (const t of taskDetails) {
    console.log(`\n${'─'.repeat(72)}`);
    console.log(`  ${t.key}  [${t.status}]`);
    console.log(`  ${t.summary.substring(0, 80)}`);
    console.log(`  优先级: ${t.priority}  |  解决结果: ${t.resolution || '未解决'}`);
    if (t.sprint) console.log(`  Sprint: ${t.sprint}`);
    if (t.linkedIsvj) console.log(`  🔗 关联缺陷: https://jira.supermap.work/browse/${t.linkedIsvj}`);
    if (t.lastComment) {
      console.log(`  最近评论: ${t.lastComment.author} (${fmtDate(t.lastComment.created)})`);
      console.log(`    ${t.lastComment.body}${t.lastComment.body.length >= 100 ? '...' : ''}`);
    }
  }

  // ---- 第5步: 统计 ----
  console.log(`\n${'─'.repeat(72)}`);
  console.log(`📊 统计`);
  console.log(`  任务数: ${taskDetails.length}`);
  const statusCounts = {};
  for (const t of taskDetails) {
    statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
  }
  console.log(`  状态分布: ${Object.entries(statusCounts).map(([k, v]) => `${k}:${v}`).join(', ')}`);
  const linked = taskDetails.filter(t => t.linkedIsvj).length;
  console.log(`  关联缺陷: ${linked}/${taskDetails.length}`);
  console.log('='.repeat(72));
}

main().catch(e => console.error('❌', e.message));
