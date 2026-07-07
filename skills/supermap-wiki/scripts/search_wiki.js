#!/usr/bin/env node
/**
 * Supermap Wiki Search Script (Node.js Version)
 *
 * Searches the Supermap Confluence wiki and returns results as a markdown table.
 * Uses the SUPERMAP_WIKI_TOKEN environment variable for authentication.
 */

const https = require('https');

const WIKI_BASE_URL = 'wiki.ispeco.com';
const API_BASE_URL = '/rest/api/search';

function getToken() {
    const token = process.env.SUPERMAP_WIKI_TOKEN;
    if (!token) {
        console.error('Error: SUPERMAP_WIKI_TOKEN environment variable is not set.');
        console.error('Please set it using:');
        console.error('  Linux/macOS: export SUPERMAP_WIKI_TOKEN=\'your-token\'');
        console.error('  Windows (cmd): set SUPERMAP_WIKI_TOKEN=your-token');
        console.error('  Windows (PowerShell): $env:SUPERMAP_WIKI_TOKEN=\'your-token\'');
        process.exit(1);
    }
    return token;
}

function buildSearchUrl(query, limit = 20) {
    // Build CQL query
    const cql = `siteSearch ~ "${query}" AND type in ("space","user","com.atlassian.confluence.extra.team-calendars:calendar-content-type","attachment","page","com.atlassian.confluence.extra.team-calendars:space-calendars-view-content-type","blogpost")`;

    const params = new URLSearchParams({
        cql: cql,
        start: '0',
        limit: limit.toString(),
        excerpt: 'highlight',
        expand: 'space.icon',
        includeArchivedSpaces: 'false'
    });

    return `${API_BASE_URL}?${params.toString()}`;
}

function makeRequest(url, token) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: WIKI_BASE_URL,
            path: url,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
                'User-Agent': 'Supermap-Wiki-Search/1.0'
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
                    reject(new Error('Authentication failed. Please check your SUPERMAP_WIKI_TOKEN.'));
                } else if (res.statusCode === 403) {
                    reject(new Error('Access forbidden. You may not have permission to search the wiki.'));
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

async function searchWiki(query, token, limit) {
    const url = buildSearchUrl(query, limit);

    try {
        const response = await makeRequest(url, token);
        return response;
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

function cleanExcerpt(excerpt) {
    if (!excerpt) return '';

    // Remove HTML highlight tags and convert to markdown bold
    let cleaned = excerpt
        .replace(/<span class="search-highlight">/g, '**')
        .replace(/<\/span>/g, '**')
        .replace(/\n/g, ' ')
        .trim();

    // Truncate long excerpts
    if (cleaned.length > 150) {
        cleaned = cleaned.substring(0, 147) + '...';
    }

    return cleaned;
}

function escapePipe(str) {
    return str ? str.replace(/\|/g, '\\|') : '';
}

function formatAsMarkdown(results) {
    if (!results || !results.results || results.results.length === 0) {
        console.log('No results found.');
        return;
    }

    // Table header
    console.log('| Title | Space | Excerpt |');
    console.log('|-------|-------|---------|');

    // Table rows
    for (const result of results.results) {
        const content = result.content || {};
        const title = content.title || 'N/A';

        // Get space name
        const container = result.resultGlobalContainer || {};
        const space = container.title || 'N/A';

        // Get excerpt and clean it up
        const excerpt = cleanExcerpt(result.excerpt);

        // Build link
        const webuiLink = content._links?.webui || '';
        const titleWithLink = webuiLink
            ? `[${title}](https://${WIKI_BASE_URL}${webuiLink})`
            : title;

        // Escape pipe characters
        const escapedTitle = escapePipe(titleWithLink);
        const escapedSpace = escapePipe(space);
        const escapedExcerpt = escapePipe(excerpt);

        console.log(`| ${escapedTitle} | ${escapedSpace} | ${escapedExcerpt} |`);
    }

    const totalSize = results.totalSize || 0;
    const shownResults = results.results.length;
    if (totalSize > shownResults) {
        console.log(`\n_Showing ${shownResults} of ${totalSize} results_`);
    }
}

function printHelp() {
    console.log(`Supermap Wiki Search (Node.js Version)

Usage: node search_wiki.js <search-query> [options]

Description:
    Search Supermap wiki and display results as a markdown table.

Environment Variables:
    SUPERMAP_WIKI_TOKEN  - Required. Your wiki API token for authentication.

Options:
    -l, --limit <number>  Maximum number of results (default: 20)
    -h, --help           Show this help message

Examples:
    node search_wiki.js "project documentation"
    node search_wiki.js deployment -l 50
    node search_wiki.js --help

Output:
    Results are displayed as a markdown table with titles, spaces, and excerpts.
`);
}

function parseArgs(args) {
    const result = {
        query: '',
        limit: 20,
        help: false
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === '-h' || arg === '--help') {
            result.help = true;
        } else if ((arg === '-l' || arg === '--limit') && i + 1 < args.length) {
            const limit = parseInt(args[i + 1], 10);
            if (!isNaN(limit) && limit > 0) {
                result.limit = limit;
            }
            i++;
        } else if (!result.query) {
            result.query = arg;
        } else {
            result.query += ' ' + arg;
        }
    }

    return result;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    if (args.help || !args.query) {
        printHelp();
        process.exit(0);
    }

    const token = getToken();

    const data = await searchWiki(args.query, token, args.limit);
    formatAsMarkdown(data);
}

main().catch(err => {
    console.error(`Unexpected error: ${err.message}`);
    process.exit(1);
});
