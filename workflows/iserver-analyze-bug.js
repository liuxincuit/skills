export const meta = {
  name: 'iserver-analyze-bug',
  description: '通用 Jira Bug 分析工作流：读 Jira → 搜 iServer 文档 → 搜相似缺陷 → 搜 Wiki 设计记录 → 综合结论并写入文件',
  phases: [
    { title: '获取 Jira 问题详情并提取关键词' },
    { title: '并行搜索 iServer 文档、相似 Jira 和 Wiki 设计记录' },
    { title: '综合分析并输出结论' },
    { title: '写入分析结果到文件' }
  ]
};

// ─── 参数 ────────────────────────────────────────────
const issueKey   = args?.issueKey   || 'ISVJ-11876';
const outputFile = args?.outputFile || `./${issueKey}-analysis.md`;

log(`正在分析缺陷: ${issueKey}`);
log(`输出文件: ${outputFile}`);

// ══════════════════════════════════════════════════
// Phase 1: 获取 Jira 问题详情并提取关键词
// ══════════════════════════════════════════════════
phase('获取 Jira 问题详情并提取关键词');

const phase1Result = await agent(`你是一个缺陷分析助手，需要完成两项任务：

## 任务 1：使用 supermap-jira 技能获取 Jira 问题
首先搜索 "supermap-jira" 的 SKILL.md 找到该技能

阅读 SKILL.md 了解使用方法，然后运行脚本读取 Jira 问题：
${issueKey}

输出命令的完整原始输出。注意：脚本现在也会输出 Jira 评论——QA 工程师经常在评论中记录复现结果和补充场景，请一并包含在输出中。

## 任务 2：提取搜索关键词
获取问题后，分析其内容（标题、描述、复现步骤、错误信息、环境），提取 5-10 个有助于找到相关文档和相似缺陷的搜索关键词/短语。

请按以下格式输出结果（这很关键）：

### RAW_JIRA
（此处放完整的 Jira 原始输出）
### END_RAW_JIRA

### KEYWORDS
- 关键词 1（该关键词针对什么的说明）
- 关键词 2（说明）
- ...
### END_KEYWORDS

### SUMMARY
用 2-3 句中文总结这个缺陷的内容。
### END_SUMMARY`, {
  label: 'fetch jira and extract keywords',
  tier: 'small'
});

log('阶段 1 结果长度: ' + (phase1Result || '').length);

// 解析结构化输出
function extractSection(text, startMarker, endMarker) {
  const startIdx = text.indexOf(startMarker);
  if (startIdx === -1) return '';
  const contentStart = startIdx + startMarker.length;
  const endIdx = text.indexOf(endMarker, contentStart);
  if (endIdx === -1) return text.substring(contentStart).trim();
  return text.substring(contentStart, endIdx).trim();
}

const jiraRaw       = extractSection(phase1Result, '### RAW_JIRA', '### END_RAW_JIRA');
const keywordsBlock = extractSection(phase1Result, '### KEYWORDS', '### END_KEYWORDS');
const issueSummary  = extractSection(phase1Result, '### SUMMARY', '### END_SUMMARY');

// 提取关键词短语（以 - 开头的行）
const keywordLines = (keywordsBlock || '')
  .split('\n')
  .map(l => l.trim())
  .filter(l => l.startsWith('- '))
  .map(l => l.replace(/^- /, '').replace(/\(.*\)$/, '').trim());

const topKeywords = keywordLines.slice(0, 6);

log(`缺陷摘要: ${issueSummary}`);
log(`提取到 ${topKeywords.length} 个关键词: ${topKeywords.join(', ')}`);

// 解析失败时的回退
const jiraDetail = jiraRaw || phase1Result || '(无可用详情)';
const kwList = topKeywords.length > 0 ? topKeywords : ['iServer'];
const keywordsStr = kwList.join('\n');
const summaryText = issueSummary || `缺陷 ${issueKey} 分析`;

// ══════════════════════════════════════════════════
// Phase 2: 并行搜索 — iServer 文档、相似 Jira、Confluence wiki
// ══════════════════════════════════════════════════
phase('并行搜索 iServer 文档、相似 Jira 和 Wiki 设计记录');

const [wikiSearchResult, similarJiraResult, confluenceResult] = await parallel([
  () => agent(`你正在 SuperMap iServer Wiki 知识库中搜索与某个缺陷相关的文档。

## 缺陷摘要
${summaryText}

## 缺陷详情
${jiraDetail}

## 待搜索关键词
${keywordsStr}

## 操作说明
使用 "iserver-help" 技能。通过搜索 "iserver-help" 的 SKILL.md 找到该技能

阅读技能文件了解如何搜索知识库，然后：

1. 阅读 wiki 索引: head -200 wiki/index.md（相对于 iServer-Wiki 目录）
2. 使用 wiki-search.py 脚本逐个搜索每个关键词
3. 如果找到相关页面，读取它们以获取更多细节

## 报告结构
- 找到了哪些与缺陷技术场景相关的文档？
- iServer 是否官方支持缺陷中描述的配置/功能？
- 是否有相关的配置指南、故障排查页面或已知限制？
- 是否发现了文档缺口？`, {
    label: 'search iserver wiki',
    tier: 'medium'
  }),
  () => agent(`你正在 SuperMap Jira 中搜索与某个缺陷相关的相似问题。

## 缺陷摘要
${summaryText}

## 缺陷详情
${jiraDetail}

## 待搜索关键词
${keywordsStr}

## 操作说明
使用 "supermap-jira" 技能。通过搜索 "supermap-jira" 的 SKILL.md 找到该技能

阅读 SKILL.md 了解使用方法，然后用每个关键词在 Jira 中搜索。

同时使用以下内容搜索：
- 缺陷描述中的关键错误信息
- 功能/组件名称
- 配置相关术语（根据实际缺陷调整）

## 报告结构
每次搜索都展示结果。如果没有找到问题，请注明 "未找到问题"。
然后分析：
1. 是否存在相似/相关的缺陷？
2. 这是已知缺陷还是新问题？
3. 列出所有相关 Jira 问题及关联程度（高/中/低）`, {
    label: 'search similar jira',
    tier: 'medium'
  }),
  () => agent(`你正在 SuperMap Confluence wiki 中搜索与某个缺陷相关的设计文档、测试记录和技术分析。

## 缺陷摘要
${summaryText}

## 缺陷详情
${jiraDetail}

## 待搜索关键词
${keywordsStr}

## 操作说明
使用 "supermap-wiki" 技能。通过搜索 "supermap-wiki" 的 SKILL.md 找到该技能

阅读 SKILL.md 了解使用方法，然后用每个关键词在 Confluence wiki 中搜索。

同时使用关键词的简短/更宽泛变体进行搜索。

## 报告结构
每次搜索都展示结果。如果没有找到结果，请注明 "未找到结果"。
然后分析：
1. 是否有关于缺陷功能/场景的设计文档？
2. 是否有覆盖该场景的测试记录？
3. 是否有技术分析、已知限制或架构讨论？`, {
    label: 'search confluence wiki',
    tier: 'medium'
  })
]);

log('并行搜索完成。Wiki: ' + (wikiSearchResult || '').length + ', Jira: ' + (similarJiraResult || '').length + ', Confluence: ' + (confluenceResult || '').length);

// ══════════════════════════════════════════════════
// Phase 5: 综合分析并输出结论
// ══════════════════════════════════════════════════
phase('综合分析并输出结论');

// 转义，以便嵌入 agent 提示词（反引号模板字符串）
function esc(s) {
  return (s || '').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
}

const conclusion = await agent(`你是一名资深技术分析师。请综合所有证据判断缺陷是否真实存在。

## 缺陷摘要
${esc(summaryText)}

## 缺陷详情
${esc(jiraDetail)}

## 调查结果

### iServer 文档搜索结果：
${esc(wikiSearchResult) || 'iServer wiki 搜索无结果。'}

### 相似 Jira 问题：
${esc(similarJiraResult) || 'Jira 搜索无结果。'}

### Confluence Wiki（设计文档、测试记录）：
${esc(confluenceResult) || 'Confluence 搜索无结果。'}

## 输出要求
输出结构化结论：

### 1. 结论：缺陷有效性
**属于** / **不属于** / **无法判断**

### 2. iServer 帮助文档分析
- iServer 是否官方支持描述中的配置/功能？
- 是否有关于该具体场景的文档？
- 已知的需求或限制？

### 3. 相似 Jira 问题
- 列出相关问题及编号和关联程度
- 已知缺陷还是新问题？

### 4. Wiki 设计文档与测试记录
- 是否找到设计文档、测试记录、技术分析？

### 5. 最终分析
如果是缺陷：解释根因。如果不是缺陷：说明正确行为。如果无法判断：说明还需要什么。

请用中文撰写。`, {
  label: 'synthesize conclusion',
  tier: 'big'
});

log('=== 最终结论 ===');
log(conclusion || '未生成结论。');

// ══════════════════════════════════════════════════
// Phase 6: 写入结果到本地文件
// ══════════════════════════════════════════════════
phase('写入分析结果到文件');

const fileContent = `# ${issueKey} Bug 分析报告

${conclusion || '未生成结论。'}
`;

const escapedContent = fileContent
  .replace(/\\/g, '\\\\')
  .replace(/`/g, '\\`')
  .replace(/\$/g, '\\$');

const writeResult = await agent(`将以下分析结果写入文件。

文件路径: ${outputFile}

使用 Node.js：

node -e "
const fs = require('fs');
const content = \`${escapedContent}\`;
fs.writeFileSync('${outputFile}', content, 'utf8');
console.log('Written ' + content.length + ' bytes to ${outputFile}');
"

然后验证: ls -la ${outputFile}`, {
  label: 'write result file',
  tier: 'small'
});

log('写入结果: ' + (writeResult || ''));

return {
  ok: true,
  verdict: (conclusion || '').includes('属于') ? 'bug' : (conclusion || '').includes('不属于') ? 'not_bug' : 'uncertain',
  jira_key: issueKey,
  output_file: outputFile
};
