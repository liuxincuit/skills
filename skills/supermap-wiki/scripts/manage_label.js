#!/usr/bin/env node
/**
 * Supermap Wiki Label Manager Script
 *
 * Manages labels on a wiki page: list, add, remove.
 * Environment: SUPERMAP_WIKI_TOKEN
 */

const https = require('https');

const WIKI_BASE_URL = 'wiki.ispeco.com';

function getToken() {
    const token = process.env.SUPERMAP_WIKI_TOKEN;
    if (!token) {
        console.error('Error: SUPERMAP_WIKI_TOKEN environment variable is not set.');
        process.exit(1);
    }
    return token;
}

function makeRequest(path, token, method = 'GET', postData = null) {
    return new Promise((resolve, reject) => {
        const headers = {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
            'User-Agent': 'Supermap-Wiki-ManageLabel/1.0'
        };
        if (postData) {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(postData);
        }
        const req = https.request({
            hostname: WIKI_BASE_URL,
            path: path,
            method: method,
            headers: headers,
            timeout: 30000,
            rejectUnauthorized: false
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(data ? JSON.parse(data) : null);
                    } catch (e) {
                        resolve(data);
                    }
                } else if (res.statusCode === 401) {
                    reject(new Error('Authentication failed. Please check your SUPERMAP_WIKI_TOKEN.'));
                } else if (res.statusCode === 403) {
                    reject(new Error('Access forbidden. You may not have permission to edit this page.'));
                } else if (res.statusCode === 404) {
                    reject(new Error('Page not found. Please check the pageId.'));
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
                }
            });
        });
        req.on('error', (err) => reject(new Error(`Network error: ${err.message}`)));
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        if (postData) req.write(postData);
        req.end();
    });
}

async function getLabels(pageId, token) {
    const data = await makeRequest(`/rest/api/content/${pageId}?expand=metadata.labels`, token);
    return (data?.metadata?.labels?.results || [])
        .map((label) => label.name);
}

async function listLabels(pageId, token) {
    const labels = await getLabels(pageId, token);
    if (labels.length === 0) {
        console.log('(无标签)');
    } else {
        for (const name of labels) {
            console.log(name);
        }
    }
}

async function addLabel(pageId, name, token) {
    const existing = await getLabels(pageId, token);
    if (existing.includes(name)) {
        console.log(`Label "${name}" already exists on page ${pageId}. Nothing to do.`);
        return;
    }
    await makeRequest(
        `/rest/api/content/${pageId}/label`,
        token,
        'POST',
        JSON.stringify([{ prefix: 'global', name: name }])  // 标签数组或单对象 {prefix,name} 本实例实测均 200；{"labels":[...]} 包装格式、字符串、空对象实测 400 "Could not parse Labels"，勿用
    );
    console.log(`Label added to page ${pageId}: ${name}`);
}

async function removeLabel(pageId, name, token) {
    const existing = await getLabels(pageId, token);
    if (!existing.includes(name)) {
        console.log(`Page ${pageId} does not have label "${name}". Nothing to remove.`);
        return;
    }
    await makeRequest(`/rest/api/content/${pageId}/label?name=${encodeURIComponent(name)}`, token, 'DELETE');
    console.log(`Label removed from page ${pageId}: ${name}`);
}

function printHelp() {
    console.log(`Supermap Wiki Label Manager

Usage:
  node scripts/manage_label.js list <pageId>              列出页面标签
  node scripts/manage_label.js add <pageId> <标签名>     给页面添加标签
  node scripts/manage_label.js remove <pageId> <标签名>  移除页面标签

Examples:
  node scripts/manage_label.js list 130526896
  node scripts/manage_label.js add 130526896 explored
  node scripts/manage_label.js remove 130526896 explored

Environment:
  SUPERMAP_WIKI_TOKEN  - Required. Your wiki API token.
`);
}

async function main() {
    const args = process.argv.slice(2);
    if (args[0] === '--help' || args[0] === '-h') {
        printHelp();
        process.exit(0);
    }
    if (args.length < 2) {
        printHelp();
        process.exit(1);
    }
    const command = args[0];
    const pageId = args[1];
    const name = args[2];
    const token = getToken();
    try {
        if (command === 'list') {
            await listLabels(pageId, token);
        } else if (command === 'add') {
            if (!name) throw new Error('Missing label name. Usage: add <pageId> <标签名>');
            await addLabel(pageId, name, token);
        } else if (command === 'remove') {
            if (!name) throw new Error('Missing label name. Usage: remove <pageId> <标签名>');
            await removeLabel(pageId, name, token);
        } else {
            printHelp();
            process.exit(1);
        }
    } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
    }
}

main().catch((err) => {
    console.error(`Unexpected error: ${err.message}`);
    process.exit(1);
});
