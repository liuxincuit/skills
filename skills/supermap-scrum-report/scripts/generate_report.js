#!/usr/bin/env node

/**
 * Scrum 工作报告生成工具
 *
 * 整合 Scrum 活动记录 + Jira 问题详情，生成 Markdown 报告。
 * 依赖:
 *   - supermap-scrum-search/scripts/search_activity.js  (Scrum 活动查询)
 *   - supermap-jira-read/scripts/read_jira.js           (Jira 问题查询)
 *
 * 环境变量:
 *   - SUPERMAP_SCRUM_TOKEN (必需)
 *   - SUPERMAP_JIRA_TOKEN  (必需)
 */

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ===================== 路径解析 =====================
const SKILLS_DIR = path.resolve(__dirname, '..', '..');
const SEARCH_SCRIPT = path.join(SKILLS_DIR, 'supermap-scrum-search', 'scripts', 'search_activity.js');
const READ_JIRA_SCRIPT = path.join(SKILLS_DIR, 'supermap-jira-read', 'scripts', 'read_jira.js');

// ===================== 依赖检查 =====================
const DEPENDENCIES = [
  { name: 'supermap-scrum-search/scripts/search_activity.js', path: SEARCH_SCRIPT },
  { name: 'supermap-jira-read/scripts/read_jira.js', path: READ_JIRA_SCRIPT }
];

for (const dep of DEPENDENCIES) {
  if (!fs.existsSync(dep.path)) {
    console.error(`❌ 依赖脚本缺失: ${dep.path}`);
    console.error(`   请确保 ${dep.name.split('/')[0]} skill 已安装并包含此脚本`);
    process.exit(1);
  }
}

// ===================== 参数解析 =====================
const cliArgs = process.argv.slice(2);

function getArg(name) {
  const idx = cliArgs.indexOf(name);
  return idx >= 0 ? cliArgs[idx + 1] : null;
}

function hasFlag(name) {
  return cliArgs.includes(name);
}

const now = new Date();
const untilDefault = now.toISOString().substring(0, 10);
const sinceDefault = (() => {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().substring(0, 10);
})();

const since = getArg('--since') || sinceDefault;
const until = getArg('--until') || untilDefault;
const username = getArg('--user') || 'liuxin1';
const statusFilter = getArg('--status') || '处理中,已完成,已验收';
const outputPath = getArg('--output') || `scrum-report_${since}_${until}.md`;

// ===================== 辅助函数 =====================

/**
 * 将子进程 stdout 解析为 JSON
 */
function execJSON(script, args) {
  const result = execFileSync('node', [script, ...args], {
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024
  });
  return JSON.parse(result);
}

/**
 * 格式化日期时间为短格式
 */
function fmtShort(isoStr) {
  if (!isoStr) return '';
  try {
    return new Date(isoStr).toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'Asia/Shanghai'
    });
  } catch {
    return isoStr;
  }
}

/**
 * 格式化日期为完整格式
 */
function fmtFull(isoStr) {
  if (!isoStr) return '';
  try {
    return new Date(isoStr).toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai'
    });
  } catch {
    return isoStr;
  }
}

// ===================== 主流程 =====================

function main() {
  // ---- 第1步: 查询 Scrum 活动 ----
  console.error(`🔍 正在搜索 ${since} ~ ${until} 的 Scrum 活动 (用户: ${username})...`);

  let scrumData;
  try {
    scrumData = execJSON(SEARCH_SCRIPT, [
      '--since', since,
      '--until', until,
      '--user', username,
      '--status', statusFilter,
      '--json'
    ]);
  } catch (e) {
    console.error(`❌ Scrum 查询失败: ${e.message}`);
    process.exit(1);
  }

  if (!scrumData.tasks || scrumData.tasks.length === 0) {
    console.error('   没有找到任务记录。\n');
    console.error(`📝 生成空报告...`);
    const emptyMd = `# Scrum 工作报告 (${since} ~ ${until})\n> 用户: ${username}\n\n_该时间段内没有找到任务记录。_\n`;
    fs.writeFileSync(outputPath, emptyMd, 'utf-8');
    console.error(`✅ 报告已生成: ${outputPath}`);
    process.exit(0);
  }

  console.error(`   找到 ${scrumData.tasks.length} 个任务`);

  // ---- 第2步: 获取关联的 Jira 详情 ----
  const isvjSet = new Set(
    scrumData.tasks.map(t => t.linkedIsvj).filter(Boolean)
  );
  const isvjList = [...isvjSet];

  console.error(`   ${isvjList.length} 个关联的 Jira 问题`);

  const jiraCache = {};
  for (const isvj of isvjList) {
    process.stdout.write(`   正在获取 Jira: ${isvj} ... `);
    try {
      jiraCache[isvj] = execJSON(READ_JIRA_SCRIPT, [isvj, '--json']);
      console.error('OK');
    } catch (e) {
      console.error(`失败: ${e.message}`);
      jiraCache[isvj] = null;
    }
  }

  // ---- 第3步: 生成 Markdown 报告 ----
  console.error(`\n📝 正在生成报告...`);

  // 任务按状态分组
  const statusOrder = ['已验收', '已完成', '处理中', '未开始'];
  const statusLabels = {
    '已验收': '✔️ 已验收',
    '已完成': '✅ 已完成',
    '处理中': '🏗️ 处理中',
    '未开始': '⏳ 未开始'
  };

  const grouped = {};
  for (const task of scrumData.tasks) {
    const s = task.status || '未开始';
    if (!grouped[s]) grouped[s] = [];
    grouped[s].push(task);
  }

  // 每个任务的活动按时间排序
  const activitiesByTask = {};
  if (scrumData.activities) {
    const sorted = [...scrumData.activities].sort(
      (a, b) => new Date(a.time) - new Date(b.time)
    );
    for (const act of sorted) {
      if (!activitiesByTask[act.key]) activitiesByTask[act.key] = [];
      activitiesByTask[act.key].push(act);
    }
  }

  // 构建 Markdown
  let md = `# Scrum 工作报告 (${since} ~ ${until})\n`;
  md += `> 用户: ${username}  |  共 ${scrumData.tasks.length} 个任务\n\n`;

  for (const status of statusOrder) {
    const tasks = grouped[status] || [];
    if (tasks.length === 0) continue;

    const label = statusLabels[status] || status;
    md += `## ${label}\n\n`;

    for (const task of tasks) {
      md += `### ${task.key} - ${task.summary}\n\n`;

      md += `| 字段 | 值 |\n`;
      md += `|------|----|\n`;
      md += `| 状态 | ${task.status} |\n`;
      md += `| 解决结果 | ${task.resolution || '未解决'} |\n`;
      md += `| 优先级 | ${task.priority} |\n`;
      if (task.sprint) md += `| Sprint | ${task.sprint} |\n`;

      // Scrum 活动 (changelog)
      const activities = activitiesByTask[task.key] || [];
      if (activities.length > 0) {
        md += `\n**Scrum 活动:**\n\n`;
        for (const act of activities) {
          md += `- ${fmtShort(act.time)} — ${act.detail}\n`;
        }
        md += `\n`;
      }

      // Jira 详情
      if (task.linkedIsvj && jiraCache[task.linkedIsvj]) {
        const jira = jiraCache[task.linkedIsvj];

        md += `**关联缺陷:** [${task.linkedIsvj}](${jira.url})\n\n`;
        md += `| 字段 | 值 |\n`;
        md += `|------|----|\n`;
        md += `| Jira 状态 | ${jira.status} |\n`;
        md += `| Jira 优先级 | ${jira.priority} |\n`;
        md += `| 报告人 | ${jira.reporter.displayName} |\n`;
        md += `| 负责人 | ${jira.assignee.displayName} |\n`;
        if (jira.components && jira.components.length > 0) {
          md += `| 组件 | ${jira.components.join(', ')} |\n`;
        }
        if (jira.fixVersions && jira.fixVersions.length > 0) {
          md += `| 修复版本 | ${jira.fixVersions.join(', ')} |\n`;
        }
        md += `\n`;

        // 描述
        if (jira.description) {
          md += `**描述:**\n\n`;
          md += `${jira.description.replace(/\n/g, '\n\n')}\n\n`;
        }

        // 缺陷详情（自定义字段）
        const custom = jira.customFields || {};
        const hasCustom = custom.customfield_10040 || custom.customfield_10043 || custom.customfield_10042;
        if (hasCustom) {
          md += `**缺陷详情:**\n\n`;
          if (custom.customfield_10040) {
            md += `**【重现步骤】**\n\n${custom.customfield_10040}\n\n`;
          }
          if (custom.customfield_10043) {
            md += `**【详细描述】**\n\n${custom.customfield_10043}\n\n`;
          }
          if (custom.customfield_10042) {
            md += `**【测试环境】**\n\n${custom.customfield_10042}\n\n`;
          }
        }

        // 备注（评论）
        if (jira.comments && jira.comments.length > 0) {
          md += `**备注 (${jira.comments.length} 条):**\n\n`;
          for (const comment of jira.comments) {
            md += `> **${comment.author.displayName}** — ${fmtFull(comment.created)}\n`;
            md += `>\n`;
            const body = (comment.body || '').replace(/\n/g, '\n> ');
            md += `> ${body}\n`;
            md += `>\n\n`;
          }
        }

      } else if (task.linkedIsvj) {
        md += `**关联缺陷:** ${task.linkedIsvj}（获取失败）\n\n`;
      }

      md += `---\n\n`;
    }
  }

  // 写入文件
  fs.writeFileSync(outputPath, md, 'utf-8');
  console.error(`✅ 报告已生成: ${path.resolve(outputPath)}`);
}

main();
