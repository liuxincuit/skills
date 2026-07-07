#!/usr/bin/env node
/**
 * Supermap YouTrack Search Script (Node.js Version)
 *
 * Searches the Supermap YouTrack system and returns results as a markdown table.
 * Uses the SUPERMAP_YOUTRACK_TOKEN environment variable for authentication.
 */

const http = require('http');

const YOUTRACK_BASE_URL = 'yt.ispeco.com:8099';
const API_ENDPOINT = '/api/issues';

function getToken() {
    const token = process.env.SUPERMAP_YOUTRACK_TOKEN;
    if (!token) {
        console.error('Error: SUPERMAP_YOUTRACK_TOKEN environment variable is not set.');
        console.error('Please set it with:');
        console.error('  Linux/macOS: export SUPERMAP_YOUTRACK_TOKEN=\'your-token-here\'');
        console.error('  Windows (cmd): set SUPERMAP_YOUTRACK_TOKEN=your-token-here');
        console.error('  Windows (PowerShell): $env:SUPERMAP_YOUTRACK_TOKEN=\'your-token-here\'');
        process.exit(1);
    }
    return token;
}

function buildSearchUrl(query) {
    const params = new URLSearchParams({
        $top: '-1',
        $skip: '0',
        fields: 'id,idReadable,summary',
        query: query
    });

    return `${API_ENDPOINT}?${params.toString()}`;
}

function makeRequest(url, token) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'yt.ispeco.com',
            port: 8099,
            path: url,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
                'User-Agent': 'Supermap-YouTrack-Search/1.0'
            },
            timeout: 30000
        };

        const req = http.request(options, (res) => {
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
                    reject(new Error('Authentication failed. Please check your SUPERMAP_YOUTRACK_TOKEN.'));
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

async function searchYouTrack(query, token) {
    const url = buildSearchUrl(query);

    try {
        const response = await makeRequest(url, token);
        return response;
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

function formatAsMarkdownTable(issues) {
    if (!issues || issues.length === 0) {
        return 'No issues found.';
    }

    const lines = ['| 标题 | 链接 |', '| --- | --- |'];

    for (const issue of issues) {
        const summary = issue.summary || 'N/A';
        const idReadable = issue.idReadable || '';

        if (idReadable) {
            const url = `http://${YOUTRACK_BASE_URL}/issue/${idReadable}`;
            lines.push(`| ${summary} | ${url} |`);
        } else {
            lines.push(`| ${summary} | N/A |`);
        }
    }

    return lines.join('\n');
}

function printHelp() {
    console.log(`Supermap YouTrack Search (Node.js Version)

Usage: node search_youtrack.js <search-query>

Description:
    Search the Supermap YouTrack system and return matching issues as a markdown table.

Environment Variables:
    SUPERMAP_YOUTRACK_TOKEN  - Required. Your YouTrack API token for authentication.

Examples:
    node search_youtrack.js test
    node search_youtrack.js "bug fix"
    node search_youtrack.js CS-4408
    node search_youtrack.js --help

Output:
    Results are displayed as a markdown table with issue titles and links.
`);
}

async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
        printHelp();
        process.exit(0);
    }

    const query = args.join(' ');
    const token = getToken();

    const issues = await searchYouTrack(query, token);
    const output = formatAsMarkdownTable(issues);
    console.log(output);
}

main().catch(err => {
    console.error(`Unexpected error: ${err.message}`);
    process.exit(1);
});
