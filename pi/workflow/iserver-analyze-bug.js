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

log(`Analyzing issue: ${issueKey}`);
log(`Output file: ${outputFile}`);

// ══════════════════════════════════════════════════
// Phase 1: Fetch Jira issue & extract keywords
// ══════════════════════════════════════════════════
phase('获取 Jira 问题详情并提取关键词');

const phase1Result = await agent(`You are a bug analysis assistant. Perform two tasks:

## Task 1: Fetch the Jira issue using the supermap-jira skill
First, find the skill by searching for "supermap-jira" SKILL.md

Read the SKILL.md to understand how to use it, then run the script to read the Jira issue:
${issueKey}

Output the COMPLETE raw output of the command. Note: the script now also outputs Jira comments — QA engineers often record reproduction results and additional scenarios in comments, so include them in the output.

## Task 2: Extract search keywords
After fetching the issue, analyze its content (title, description, steps to reproduce, error messages, environment) and extract 5-10 search keywords/phrases that would help find relevant documentation and similar bugs.

Output your result in the following format (this is critical):

### RAW_JIRA
(complete raw Jira output here)
### END_RAW_JIRA

### KEYWORDS
- keyword 1 (description of what this keyword targets)
- keyword 2 (description)
- ...
### END_KEYWORDS

### SUMMARY
A 2-3 sentence summary of what this issue is about, in Chinese.
### END_SUMMARY`, {
  label: 'fetch jira and extract keywords',
  tier: 'small'
});

log('Phase 1 result length: ' + (phase1Result || '').length);

// Parse structured output
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

// Extract keyword phrases (lines starting with -)
const keywordLines = (keywordsBlock || '')
  .split('\n')
  .map(l => l.trim())
  .filter(l => l.startsWith('- '))
  .map(l => l.replace(/^- /, '').replace(/\(.*\)$/, '').trim());

const topKeywords = keywordLines.slice(0, 6);

log(`Issue summary: ${issueSummary}`);
log(`Extracted ${topKeywords.length} keywords: ${topKeywords.join(', ')}`);

// Fallback if parsing fails
const jiraDetail = jiraRaw || phase1Result || '(No details available)';
const kwList = topKeywords.length > 0 ? topKeywords : ['iServer'];
const keywordsStr = kwList.join('\n');
const summaryText = issueSummary || `Bug ${issueKey} analysis`;

// ══════════════════════════════════════════════════
// Phase 2: Parallel search — iServer docs, similar Jira, Confluence wiki
// ══════════════════════════════════════════════════
phase('并行搜索 iServer 文档、相似 Jira 和 Wiki 设计记录');

const [wikiSearchResult, similarJiraResult, confluenceResult] = await parallel([
  () => agent(`You are searching the SuperMap iServer Wiki knowledge base for documentation related to a bug.

## Bug Summary
${summaryText}

## Bug Details
${jiraDetail}

## Keywords to search
${keywordsStr}

## Instructions
Use the "iserver-help" skill. Find the skill by searching for "iserver-help" SKILL.md

Read the skill file to understand how to search the knowledge base, then:

1. Read the wiki index: head -200 wiki/index.md (relative to the iServer-Wiki directory)
2. Search with each keyword using the wiki-search.py script
3. If relevant pages are found, read them for more detail

## Report Structure
- Which documents were found related to the issue's technical scenario?
- Does iServer officially support the configuration/feature described in the issue?
- Are there relevant configuration guides, troubleshooting pages, or known limitations?
- Any documentation gaps identified?`, {
    label: 'search iserver wiki',
    tier: 'medium'
  }),
  () => agent(`You are searching SuperMap Jira for similar issues related to a bug.

## Bug Summary
${summaryText}

## Bug Details
${jiraDetail}

## Keywords to search
${keywordsStr}

## Instructions
Use the "supermap-jira" skill. Find it by searching for "supermap-jira" SKILL.md

Read the SKILL.md to understand how to use it, then for each keyword search Jira.

Also search using:
- Key error messages from the bug description
- Feature/component names
- Configuration terms (adapt to the actual issue)

## Report Structure
For each search, show results. Note if "No issues found."
Then analyze:
1. Are there any similar/related bugs?
2. Is this a known defect or a new issue?
3. List all related Jira issues with relevance level (高/中/低)`, {
    label: 'search similar jira',
    tier: 'medium'
  }),
  () => agent(`You are searching SuperMap Confluence wiki for design documents, test records, and technical analysis related to a bug.

## Bug Summary
${summaryText}

## Bug Details
${jiraDetail}

## Keywords to search
${keywordsStr}

## Instructions
Use the "supermap-wiki" skill. Find it by searching for "supermap-wiki" SKILL.md

Read the SKILL.md to understand how to use it, then for each keyword search Confluence wiki.

Also search with shorter/broader variants of the keywords.

## Report Structure
For each search, show results. Note if "No results found."
Then analyze:
1. Any design documents about the issue's feature/scenario?
2. Any test records covering this scenario?
3. Any technical analysis, known limitations, or architectural discussions?`, {
    label: 'search confluence wiki',
    tier: 'medium'
  })
]);

log('Parallel search done. Wiki: ' + (wikiSearchResult || '').length + ', Jira: ' + (similarJiraResult || '').length + ', Confluence: ' + (confluenceResult || '').length);

// ══════════════════════════════════════════════════
// Phase 5: Synthesize conclusion
// ══════════════════════════════════════════════════
phase('综合分析并输出结论');

// Escape for embedding in an agent prompt (backtick template literal)
function esc(s) {
  return (s || '').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
}

const conclusion = await agent(`You are a senior technical analyst. Synthesize all evidence to determine if the bug is real.

## Bug Summary
${esc(summaryText)}

## Bug Details
${esc(jiraDetail)}

## Investigation Results

### iServer Documentation Search:
${esc(wikiSearchResult) || 'No results from iServer wiki search.'}

### Similar Jira Issues:
${esc(similarJiraResult) || 'No results from Jira search.'}

### Confluence Wiki (Design docs, test records):
${esc(confluenceResult) || 'No results from Confluence search.'}

## Required Output
Produce a structured conclusion:

### 1. Conclusion: Bug Validity
**属于** / **不属于** / **无法判断**

### 2. iServer Help Docs Analysis
- Does iServer officially support the described configuration/feature?
- Is there documentation about the specific scenario?
- Known requirements or limitations?

### 3. Similar Jira Issues
- List related issues with keys and relevance
- Known defect or new issue?

### 4. Wiki Design Docs & Test Records
- Design docs, test records, technical analysis found?

### 5. Final Analysis
If bug: root cause explanation. If not bug: correct behavior. If unsure: what's needed.

Write in Chinese.`, {
  label: 'synthesize conclusion',
  tier: 'big'
});

log('=== FINAL CONCLUSION ===');
log(conclusion || 'No conclusion generated.');

// ══════════════════════════════════════════════════
// Phase 6: Write result to local file
// ══════════════════════════════════════════════════
phase('写入分析结果到文件');

const fileContent = `# ${issueKey} Bug 分析报告

${conclusion || 'No conclusion generated.'}
`;

const escapedContent = fileContent
  .replace(/\\/g, '\\\\')
  .replace(/`/g, '\\`')
  .replace(/\$/g, '\\$');

const writeResult = await agent(`Write the following analysis result to a file.

Create the file at: ${outputFile}

Use Node.js:

node -e "
const fs = require('fs');
const content = \`${escapedContent}\`;
fs.writeFileSync('${outputFile}', content, 'utf8');
console.log('Written ' + content.length + ' bytes to ${outputFile}');
"

Then verify: ls -la ${outputFile}`, {
  label: 'write result file',
  tier: 'small'
});

log('Write result: ' + (writeResult || ''));

return {
  ok: true,
  verdict: (conclusion || '').includes('属于') ? 'bug' : (conclusion || '').includes('不属于') ? 'not_bug' : 'uncertain',
  jira_key: issueKey,
  output_file: outputFile
};
