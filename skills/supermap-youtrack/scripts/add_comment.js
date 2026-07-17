#!/usr/bin/env node
const http = require('http');

const YOUTRACK_HOST = 'yt.ispeco.com';
const YOUTRACK_PORT = 8099;

const token = process.env.SUPERMAP_YOUTRACK_TOKEN;
if (!token) {
    console.error('Error: SUPERMAP_YOUTRACK_TOKEN environment variable is not set.');
    process.exit(1);
}

const args = process.argv.slice(2);
if (args.length < 2) {
    console.error('Usage: node add_comment.js <issue-key> <comment-text-file-or-string>');
    process.exit(1);
}

const issueKey = args[0];
const commentText = args.slice(1).join(' ');

function addComment(issueKey, text) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({ text });

        const options = {
            hostname: YOUTRACK_HOST,
            port: YOUTRACK_PORT,
            path: `/api/issues/${issueKey}/comments`,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
                'Accept': 'application/json',
                'User-Agent': 'Supermap-YouTrack-AddComment/1.0'
            },
            timeout: 30000
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        resolve(data);
                    }
                } else if (res.statusCode === 401) {
                    reject(new Error('Authentication failed (401)'));
                } else if (res.statusCode === 404) {
                    reject(new Error(`Issue not found (404): ${issueKey}`));
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        });

        req.on('error', err => reject(new Error(`Network error: ${err.message}`)));
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        req.write(postData);
        req.end();
    });
}

(async () => {
    try {
        const result = await addComment(issueKey, commentText);
        console.log(`Comment added to ${issueKey} successfully.`);
        if (result && result.id) {
            console.log(`Comment ID: ${result.id}`);
        }
    } catch (err) {
        console.error(`Failed to add comment: ${err.message}`);
        process.exit(1);
    }
})();
