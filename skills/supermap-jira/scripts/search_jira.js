#!/usr/bin/env node
/**
 * Supermap Jira Search Script (Node.js Version)
 *
 * Searches the Supermap Jira system using JQL API and returns results as a markdown table.
 * Uses the SUPERMAP_JIRA_TOKEN environment variable for authentication.
 */

const https = require('https');

const JIRA_BASE_URL = 'jira.supermap.work';
const API_ENDPOINT = '/rest/api/2/search';

function getToken() {
    const token = process.env.SUPERMAP_JIRA_TOKEN;
    if (!token) {
        console.error('Error: SUPERMAP_JIRA_TOKEN environment variable is not set.');
        console.error('Please set it with:');
        console.error('  Linux/macOS: export SUPERMAP_JIRA_TOKEN=\'your-token-here\'');
        console.error('  Windows (cmd): set SUPERMAP_JIRA_TOKEN=your-token-here');
        console.error('  Windows (PowerShell): $env:SUPERMAP_JIRA_TOKEN=\'your-token-here\'');
        process.exit(1);
    }
    return token;
}

function makeRequest(url, token) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: JIRA_BASE_URL,
            path: url,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
                'User-Agent': 'Supermap-Jira-Search/1.0'
            },
            timeout: 30000,
            rejectUnauthorized: false
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const jsonData = JSON.parse(data);
                        resolve(jsonData);
                    } catch (e) {
                        reject(new Error(`Failed to parse response: ${e.message}`));
                    }
                } else if (res.statusCode === 401) {
                    reject(new Error('Authentication failed. Please check your SUPERMAP_JIRA_TOKEN.'));
                } else if (res.statusCode === 403) {
                    reject(new Error('Access forbidden. You may not have permission to search.'));
                } else {
                    reject(new Error(`HTTP ${res.statusCode}`));
                }
            });
        });

        req.on('error', (err) => {
            reject(new Error(`Network error: ${err.message}`));
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        req.end();
    });
}

function buildJql(query, useRawJql) {
    if (useRawJql) {
        return query;
    }
    // Free-text search: escape double quotes in the query
    const escaped = query.replace(/"/g, '\\"');
    return `(summary ~ "${escaped}" OR description ~ "${escaped}") ORDER BY created DESC`;
}

async function searchJira(jql, token) {
    const encodedJql = encodeURIComponent(jql);
    const url = `${API_ENDPOINT}?jql=${encodedJql}&maxResults=30&fields=summary,status,priority,fixVersions,created`;

    try {
        const response = await makeRequest(url, token);
        return response;
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

function formatAsMarkdownTable(response) {
    const issues = response.issues || [];

    if (!issues || issues.length === 0) {
        return `No issues found. (total: ${response.total || 0})`;
    }

    const lines = ['| Key | 状态 | 优先级 | 版本 | 标题 |', '| --- | --- | --- | --- | --- |'];

    for (const issue of issues) {
        const key = issue.key || 'N/A';
        const fields = issue.fields || {};
        const summary = fields.summary || 'N/A';
        const status = fields.status ? fields.status.name : 'N/A';
        const priority = fields.priority ? fields.priority.name : 'N/A';
        const versions = (fields.fixVersions || []).map(v => v.name).join(', ') || '-';

        lines.push(`| ${key} | ${status} | ${priority} | ${versions} | ${summary} |`);
    }

    if (response.total > issues.length) {
        lines.push('');
        lines.push(`> 共 ${response.total} 条结果，显示前 ${issues.length} 条。`);
    }

    return lines.join('\n');
}

function printHelp() {
    console.log(`Supermap Jira Search (Node.js Version) - JQL API

Usage: node search_jira.js [--jql] <search-query>

Description:
    Search the Supermap Jira system using JQL and return matching issues.

    By default, the search query is treated as free-text, searching issue
    summary and description fields. Use --jql flag to pass raw JQL.

Environment Variables:
    SUPERMAP_JIRA_TOKEN  - Required. Your Jira API token for authentication.

Examples:
    node search_jira.js "范围查询"
    node search_jira.js --jql "(summary ~ \"范围查询\" OR summary ~ \"BOUNDS\") AND project = ISVJ ORDER BY created DESC"

Output:
    Results are displayed as a markdown table with key, status, priority, versions, and title.
`);
}

async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
        printHelp();
        process.exit(0);
    }

    const useRawJql = args[0] === '--jql';
    if (useRawJql) {
        args.shift();
    }

    if (args.length === 0) {
        console.error('Error: No search query provided.');
        printHelp();
        process.exit(1);
    }

    const query = args.join(' ');
    const token = getToken();
    const jql = buildJql(query, useRawJql);
    const response = await searchJira(jql, token);
    const output = formatAsMarkdownTable(response);
    console.log(output);
}

main().catch(err => {
    console.error(`Unexpected error: ${err.message}`);
    process.exit(1);
});
