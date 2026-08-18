const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

const WIKI_TOKEN = process.env.SUPERMAP_WIKI_TOKEN;
const WIKI_HOST = 'wiki.ispeco.com';

if (!WIKI_TOKEN) {
    console.error('Error: SUPERMAP_WIKI_TOKEN environment variable is not set');
    process.exit(1);
}

// 解析命令行参数
function parseArgs() {
    const args = process.argv.slice(2);
    const result = {
        command: args[0],
        space: null,
        title: null,
        pageId: null,
        parentId: null,
        contentPath: null
    };

    for (let i = 1; i < args.length; i += 2) {
        const key = args[i];
        const value = args[i + 1];
        if (key === '--space') result.space = value;
        else if (key === '--title') result.title = value;
        else if (key === '--pageId') result.pageId = value;
        else if (key === '--parent') result.parentId = value;
        else if (key === '--content') result.contentPath = value;
    }

    return result;
}

// 通用 HTTP 请求函数
function makeRequest(options, postData = null) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        resolve(data);
                    }
                } else {
                    reject({ statusCode: res.statusCode, data: data });
                }
            });
        });

        req.on('error', reject);

        if (postData) {
            req.write(postData);
        }
        req.end();
    });
}

// 获取页面信息
async function getPageInfo(pageId) {
    const options = {
        hostname: WIKI_HOST,
        path: `/rest/api/content/${pageId}?expand=version,space`,
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${WIKI_TOKEN}`,
            'Content-Type': 'application/json'
        }
    };
    return await makeRequest(options);
}

// 将 markdown 内容包装为 Confluence markdown 宏 storage 格式
// 格式参考: <ac:structured-macro ac:name="markdown" ...><ac:plain-text-body><![CDATA[原始 markdown]]></ac:plain-text-body></ac:structured-macro>
// 这样 markdown 原文直接交给宏渲染,不再需要手工转换为 Storage XHTML
function markdownToStorage(markdown) {
    // CDATA 中不能包含 "]]>" 序列,遇到时拆分为 "]]]]><![CDATA[>" 保持原文
    const safeContent = String(markdown).replace(/\]\]>/g, ']]]]><![CDATA[>');
    // macro-id 为 UUID,由 Confluence 用于宏实例定位
    const macroId = crypto.randomUUID();
    return `<ac:structured-macro ac:name="markdown" ac:schema-version="1" ac:macro-id="${macroId}">` +
        `<ac:parameter ac:name="atlassian-macro-output-type">INLINE</ac:parameter>` +
        `<ac:plain-text-body><![CDATA[${safeContent}]]></ac:plain-text-body>` +
        `</ac:structured-macro>`;
}

// 读取内容文件
function readContentFile(contentPath) {
    try {
        return fs.readFileSync(contentPath, 'utf8');
    } catch (e) {
        console.error(`Error: Cannot read content file: ${contentPath}`);
        console.error(e.message);
        process.exit(1);
    }
}

// 创建新页面
async function createPage(args) {
    if (!args.space || !args.title || !args.contentPath) {
        console.error('Error: Missing required parameters for create command');
        console.error('Usage: create --space <space> --title <title> --content <contentPath> [--parent <pageId>]');
        process.exit(1);
    }

    const content = readContentFile(args.contentPath);
    const storageContent = markdownToStorage(content);

    // 组装创建请求
    const body = {
        type: 'page',
        title: args.title,
        space: {
            key: args.space
        },
        body: {
            storage: {
                value: storageContent,
                representation: 'storage'
            }
        }
    };

    // 可选:在指定父页面下创建
    if (args.parentId) {
        body.ancestors = [{ id: args.parentId }];
    }

    const postData = JSON.stringify(body);

    const options = {
        hostname: WIKI_HOST,
        path: '/rest/api/content',
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${WIKI_TOKEN}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    try {
        const result = await makeRequest(options, postData);
        console.log('Page created successfully!');
        console.log(`Title: ${result.title}`);
        console.log(`Page ID: ${result.id}`);
        console.log(`Version: ${result.version?.number || 1}`);
        console.log(`Link: https://${WIKI_HOST}/pages/viewpage.action?pageId=${result.id}`);
    } catch (error) {
        console.error('Error creating page:');
        if (error.statusCode === 401) {
            console.error('Authentication failed. Please check your SUPERMAP_WIKI_TOKEN.');
        } else if (error.statusCode === 403) {
            console.error('Permission denied. You may not have access to create pages in this space.');
        } else if (error.statusCode === 404) {
            console.error('Space or parent page not found. Please check the space key / --parent pageId.');
        } else {
            console.error(`HTTP ${error.statusCode}: ${error.data}`);
        }
        process.exit(1);
    }
}

// 更新现有页面
async function updatePage(args) {
    if (!args.pageId || !args.contentPath) {
        console.error('Error: Missing required parameters for update command');
        console.error('Usage: update --pageId <pageId> --content <contentPath>');
        process.exit(1);
    }

    const content = readContentFile(args.contentPath);

    // 获取现有页面信息
    let pageInfo;
    try {
        pageInfo = await getPageInfo(args.pageId);
        console.log(`Found existing page: ${pageInfo.title} (Version ${pageInfo.version.number})`);
    } catch (e) {
        console.error(`Error: Page ${args.pageId} not found or cannot be accessed`);
        process.exit(1);
    }

    const storageContent = markdownToStorage(content);

    // 更新页面
    const nextVersion = pageInfo.version.number + 1;
    const postData = JSON.stringify({
        id: args.pageId,
        type: 'page',
        title: pageInfo.title,
        space: {
            key: pageInfo.space.key
        },
        version: {
            number: nextVersion,
            message: 'Updated via supermap-wiki'
        },
        body: {
            storage: {
                value: storageContent,
                representation: 'storage'
            }
        }
    });

    const options = {
        hostname: WIKI_HOST,
        path: `/rest/api/content/${args.pageId}`,
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${WIKI_TOKEN}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    try {
        const result = await makeRequest(options, postData);
        console.log('Page updated successfully!');
        console.log(`Title: ${result.title}`);
        console.log(`Page ID: ${result.id}`);
        console.log(`Version: ${result.version.number}`);
        console.log(`Link: https://${WIKI_HOST}/pages/viewpage.action?pageId=${result.id}`);
    } catch (error) {
        console.error('Error updating page:');
        if (error.statusCode === 401) {
            console.error('Authentication failed. Please check your SUPERMAP_WIKI_TOKEN.');
        } else if (error.statusCode === 403) {
            console.error('Permission denied. You may not have access to edit this page.');
        } else if (error.statusCode === 409) {
            console.error('Conflict: The page may have been updated by someone else. Please try again.');
        } else {
            console.error(`HTTP ${error.statusCode}: ${error.data}`);
        }
        process.exit(1);
    }
}

// 主流程
async function main() {
    const args = parseArgs();

    if (!args.command || (args.command !== 'create' && args.command !== 'update')) {
        console.error('Usage:');
        console.error('  node write_wiki.js create --space <space> --title <title> --content <path> [--parent <pageId>]');
        console.error('  node write_wiki.js update --pageId <id> --content <path>');
        process.exit(1);
    }

    if (args.command === 'create') {
        await createPage(args);
    } else {
        await updatePage(args);
    }
}

main().catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
});
