const https = require('https');
const fs = require('fs');
const path = require('path');

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
        contentPath: null,
        templateId: null
    };

    for (let i = 1; i < args.length; i += 2) {
        const key = args[i];
        const value = args[i + 1];
        if (key === '--space') result.space = value;
        else if (key === '--title') result.title = value;
        else if (key === '--pageId') result.pageId = value;
        else if (key === '--content') result.contentPath = value;
        else if (key === '--template') result.templateId = value;
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
        path: `/rest/api/content/${pageId}?expand=body.storage,version,space`,
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${WIKI_TOKEN}`,
            'Content-Type': 'application/json'
        }
    };
    return await makeRequest(options);
}

// 获取页面 storage 格式
async function getPageStorage(pageId) {
    const page = await getPageInfo(pageId);
    return page.body?.storage?.value || '';
}

// 简单的 Markdown 到 Confluence Storage XHTML 转换
function markdownToStorage(markdown, templateStructure = null) {
    const useSpan = templateStructure?.hasSpanInStrong ?? false;
    const brFormat = templateStructure?.brFormat === 'with-space' ? '<br />' : '<br/>';

    // 转义 XML 特殊字符（但保留 markdown 标记）
    const escapeXml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const lines = markdown.split('\n');
    const blocks = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

        // 空行 - 生成 <p><br /></p>
        if (!trimmed) {
            blocks.push({ type: 'empty', content: '<p><br /></p>' });
            i++;
            continue;
        }

        // 标题
        const headerMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
        if (headerMatch) {
            const level = headerMatch[1].length;
            const text = escapeXml(headerMatch[2]);
            if (useSpan) {
                blocks.push({ type: 'header', content: `<h${level}><strong><span>${text}</span></strong></h${level}>` });
            } else {
                blocks.push({ type: 'header', content: `<h${level}><strong>${text}</strong></h${level}>` });
            }
            i++;
            continue;
        }

        // 水平线
        if (trimmed === '---') {
            blocks.push({ type: 'hr', content: '<hr/>' });
            i++;
            continue;
        }

        // 表格
        if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
            const tableLines = [];
            while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
                tableLines.push(lines[i].trim());
                i++;
            }
            blocks.push({ type: 'table', content: convertTable(tableLines, templateStructure) });
            continue;
        }

        // 列表项
        if (trimmed.startsWith('- ')) {
            const listItems = [];
            while (i < lines.length && lines[i].trim().startsWith('- ')) {
                let itemText = escapeXml(lines[i].trim().substring(2));
                // 处理行内格式（粗体不加span，因为列表项已包裹）
                itemText = itemText.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
                itemText = itemText.replace(/\*(.+?)\*/g, '<em>$1</em>');
                itemText = itemText.replace(/`([^`]+)`/g, '<code>$1</code>');
                if (useSpan) {
                    listItems.push(`<li><span>${itemText}</span></li>`);
                } else {
                    listItems.push(`<li>${itemText}</li>`);
                }
                i++;
            }
            blocks.push({ type: 'list', content: `<ul>${listItems.join('')}</ul>` });
            continue;
        }

        // 普通段落
        let paraText = escapeXml(trimmed);
        // 处理行内格式
        paraText = paraText.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        paraText = paraText.replace(/\*(.+?)\*/g, '<em>$1</em>');
        paraText = paraText.replace(/`([^`]+)`/g, '<code>$1</code>');

        if (useSpan) {
            blocks.push({ type: 'para', content: `<p><span>${paraText}</span></p>` });
        } else {
            blocks.push({ type: 'para', content: `<p>${paraText}</p>` });
        }
        i++;
    }

    // 组装最终 HTML，块之间用 <br /> 分隔
    let html = '';
    for (let j = 0; j < blocks.length; j++) {
        html += blocks[j].content;
        if (j < blocks.length - 1) {
            html += brFormat;
        }
    }

    return html;
}

// 转换表格
function convertTable(lines, templateStructure = null) {
    if (lines.length < 2) return lines.join('<br/>');

    // 判断模板特征
    const useSpan = templateStructure?.hasSpanInStrong ?? false;
    const useParagraphInCell = templateStructure?.hasParagraphInTableCell ?? false;
    const hasRelativeTable = templateStructure?.hasRelativeTable ?? false;
    const hasColStyle = templateStructure?.hasColStyle ?? false;

    // 过滤掉分隔符行 (|---|)
    const contentLines = lines.filter(line => !line.match(/^\|[-:\s|]+\|$/));

    // 计算列数
    const colCount = contentLines[0].split('|').filter(c => c.trim()).length;

    // 构建表格HTML
    let tableClasses = 'wrapped';
    if (hasRelativeTable) {
        tableClasses += ' relative-table';
    }

    let tableHtml = `<table class="${tableClasses}">`;

    // colgroup
    if (hasColStyle) {
        tableHtml += '<colgroup>';
        const colWidth = Math.floor(100 / colCount);
        for (let i = 0; i < colCount; i++) {
            tableHtml += `<col style="width: ${colWidth}%;" />`;
        }
        tableHtml += '</colgroup>';
    } else {
        tableHtml += '<colgroup>';
        for (let i = 0; i < colCount; i++) {
            tableHtml += '<col />';
        }
        tableHtml += '</colgroup>';
    }

    tableHtml += '<tbody class="">';

    for (const line of contentLines) {
        const cells = line.split('|').filter(c => c.trim()).map(c => c.trim());
        tableHtml += '<tr class="">';
        for (const cell of cells) {
            // 检查是否是表头（粗体）
            const isHeader = cell.startsWith('**') && cell.endsWith('**');
            const cleanCell = isHeader ? cell.slice(2, -2) : cell;

            // 转义XML特殊字符
            const escapedCell = cleanCell
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');

            // 构建单元格内容
            let cellContent;
            if (useSpan) {
                if (isHeader) {
                    cellContent = `<strong><span>${escapedCell}</span></strong>`;
                } else {
                    cellContent = `<span>${escapedCell}</span>`;
                }
            } else {
                cellContent = isHeader ? `<strong>${escapedCell}</strong>` : escapedCell;
            }

            // 根据模板特征决定是否用 <p> 包裹
            if (useParagraphInCell) {
                tableHtml += `<td><p>${cellContent}</p></td>`;
            } else {
                tableHtml += `<td>${cellContent}</td>`;
            }
        }
        tableHtml += '</tr>';
    }

    tableHtml += '</tbody></table>';
    return tableHtml;
}

// 从模板提取样式结构
function extractTemplateStructure(templateStorage) {
    if (!templateStorage) return null;

    const structure = {
        // 是否使用 <span> 包裹文本
        hasSpanInStrong: templateStorage.includes('<strong><span>') || templateStorage.includes('<p><span>'),
        // 表格单元格是否使用 <p> 包裹
        hasParagraphInTableCell: templateStorage.includes('<td><p>'),
        // 是否使用 relative-table
        hasRelativeTable: templateStorage.includes('relative-table'),
        // 换行符格式
        brFormat: templateStorage.includes('<br />') ? 'with-space' : 'no-space',
        // 是否使用 tbody class
        hasTbodyClass: templateStorage.includes('<tbody class="">'),
        // 是否使用 col style
        hasColStyle: templateStorage.includes('<col style=')
    };

    return structure;
}

// 创建新页面
async function createPage(args) {
    if (!args.space || !args.title || !args.contentPath) {
        console.error('Error: Missing required parameters for create command');
        console.error('Usage: create --space <space> --title <title> --content <contentPath> [--template <pageId>]');
        process.exit(1);
    }

    // 读取内容
    let content = '';
    try {
        content = fs.readFileSync(args.contentPath, 'utf8');
    } catch (e) {
        console.error(`Error: Cannot read content file: ${args.contentPath}`);
        console.error(e.message);
        process.exit(1);
    }

    // 如有模板，获取模板信息并分析结构
    let templateStorage = '';
    let templateStructure = null;
    if (args.templateId) {
        try {
            templateStorage = await getPageStorage(args.templateId);
            console.log(`Using template from page ${args.templateId}`);
            templateStructure = extractTemplateStructure(templateStorage);
        } catch (e) {
            console.warn(`Warning: Could not fetch template ${args.templateId}, using default format`);
        }
    }

    // 转换内容（使用模板结构）
    const storageContent = markdownToStorage(content, templateStructure);

    // 创建页面
    const postData = JSON.stringify({
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
    });

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
            console.error('Space not found. Please check the space key.');
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
        console.error('Usage: update --pageId <pageId> --content <contentPath> [--template <pageId>]');
        process.exit(1);
    }

    // 读取内容
    let content = '';
    try {
        content = fs.readFileSync(args.contentPath, 'utf8');
    } catch (e) {
        console.error(`Error: Cannot read content file: ${args.contentPath}`);
        console.error(e.message);
        process.exit(1);
    }

    // 获取现有页面信息
    let pageInfo;
    try {
        pageInfo = await getPageInfo(args.pageId);
        console.log(`Found existing page: ${pageInfo.title} (Version ${pageInfo.version.number})`);
    } catch (e) {
        console.error(`Error: Page ${args.pageId} not found or cannot be accessed`);
        process.exit(1);
    }

    // 如有模板，获取模板信息并分析结构
    let templateStorage = '';
    let templateStructure = null;
    if (args.templateId) {
        try {
            templateStorage = await getPageStorage(args.templateId);
            console.log(`Using template from page ${args.templateId}`);
            templateStructure = extractTemplateStructure(templateStorage);
        } catch (e) {
            console.warn(`Warning: Could not fetch template ${args.templateId}, using default format`);
        }
    }

    // 转换内容（使用模板结构）
    const storageContent = markdownToStorage(content, templateStructure);

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
            message: 'Updated via supermap-wiki-writer'
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
        console.error('  node write_wiki.js create --space <space> --title <title> --content <path> [--template <id>]');
        console.error('  node write_wiki.js update --pageId <id> --content <path> [--template <id>]');
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
