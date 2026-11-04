#!/usr/bin/env node
/**
 * 在 YouTrack 中创建任务
 *
 * 用法:
 *   node create_issue.js --project ICN --summary "标题" --desc "描述"
 *   node create_issue.js --project ICN --summary "标题" --desc-file ./desc.md \
 *        --field "优先级=普通" --field "状态=待解决" --field "Type=TechTask" --field "解决人=liuxin"
 *   node create_issue.js ... --dry-run     # 只打印将要提交的 payload，不创建
 *
 * 说明:
 *   - --field 可重复，格式为「字段名=可选值名」，字段名与值名都取项目里显示的中文/英文名
 *   - 未通过 --field 指定的字段由 YouTrack 填项目默认值
 *   - customFields 必须用 projectCustomField 的 id 提交（用字段名会 400/500，见 SKILL.md 踩坑记录）
 */
const http = require('http');
const fs = require('fs');

const YOUTRACK_HOST = 'yt.ispeco.com';
const YOUTRACK_PORT = 8099;

const token = process.env.SUPERMAP_YOUTRACK_TOKEN;
if (!token) {
    console.error('Error: SUPERMAP_YOUTRACK_TOKEN environment variable is not set.');
    process.exit(1);
}

const args = process.argv.slice(2);

function getArg(name) {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : undefined;
}

function getAll(name) {
    const out = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i] === name && args[i + 1] !== undefined) out.push(args[i + 1]);
    }
    return out;
}

function request(method, path, body) {
    return new Promise((resolve, reject) => {
        const postData = body ? JSON.stringify(body) : null;
        const options = {
            hostname: YOUTRACK_HOST,
            port: YOUTRACK_PORT,
            path,
            method,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
                'User-Agent': 'Supermap-YouTrack-CreateIssue/1.0'
            },
            timeout: 30000
        };
        if (postData) {
            options.headers['Content-Type'] = 'application/json';
            options.headers['Content-Length'] = Buffer.byteLength(postData);
        }

        const req = http.request(options, (res) => {
            // 必须显式设编码：否则分块切断多字节 UTF-8 字符会产生 U+FFFD 乱码
            res.setEncoding('utf8');
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
                    reject(new Error(`Not found (404): ${path}`));
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        });

        req.on('error', err => reject(new Error(`Network error: ${err.message}`)));
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        if (postData) req.write(postData);
        req.end();
    });
}

async function resolveProject(shortName) {
    const list = await request(
        'GET',
        '/api/admin/projects?fields=id,shortName,name,archived&$top=500'
    );
    const hit = list.find(p => p.shortName === shortName);
    if (!hit) {
        const names = list.map(p => p.shortName).join(', ');
        throw new Error(`Project "${shortName}" not found. Available: ${names}`);
    }
    if (hit.archived) {
        console.error(`Warning: project ${shortName} is archived.`);
    }
    return hit;
}

async function resolveFields(projectId) {
    const proj = await request(
        'GET',
        `/api/admin/projects/${projectId}?fields=` +
            encodeURIComponent(
                'customFields($type,id,field(id,name),bundle($type,id,values($type,id,name)))'
            )
    );
    const map = new Map();
    for (const cf of proj.customFields || []) {
        const values = new Map();
        for (const v of (cf.bundle && cf.bundle.values) || []) {
            values.set(v.name, v.id);
        }
        map.set(cf.field.name, {
            pcfId: cf.id,
            pcfType: cf.$type,
            values
        });
    }
    return map;
}

async function resolveUser(value) {
    const users = await request(
        'GET',
        `/api/users?fields=id,login,name&query=` + encodeURIComponent(value)
    );
    const hit = users.find(u => u.login === value) || users[0];
    if (!hit) throw new Error(`User "${value}" not found`);
    return hit;
}

// 项目字段类型 -> issue 侧 customField 类型、值类型
const TYPE_MAP = {
    EnumProjectCustomField: { field: 'SingleEnumIssueCustomField', value: 'EnumBundleElement' },
    StateProjectCustomField: { field: 'StateIssueCustomField', value: 'StateBundleElement' },
    UserProjectCustomField: { field: 'SingleUserIssueCustomField', value: 'User' },
    VersionProjectCustomField: { field: 'MultiVersionIssueCustomField', value: 'Version' },
    PeriodProjectCustomField: { field: 'PeriodIssueCustomField', value: 'PeriodValue' }
};

async function buildCustomField(def, rawValue) {
    const t = TYPE_MAP[def.pcfType];
    if (!t) {
        throw new Error(
            `Field type ${def.pcfType} is not supported by this script (only enum/state/user/version/period)`
        );
    }

    if (def.pcfType === 'UserProjectCustomField') {
        const user = await resolveUser(rawValue);
        return {
            $type: t.field,
            id: def.pcfId,
            value: { $type: 'User', id: user.id }
        };
    }

    if (def.pcfType === 'PeriodProjectCustomField') {
        // 支持 30m / 2h / 1d / 1w
        const m = /^(\d+)([mhdw])$/i.exec(rawValue.trim());
        if (!m) throw new Error(`Period value must look like 30m / 2h / 1d / 1w, got "${rawValue}"`);
        const unit = { m: 1, h: 60, d: 480, w: 2400 }[m[2].toLowerCase()];
        return {
            $type: t.field,
            id: def.pcfId,
            value: { $type: 'PeriodValue', minutes: Number(m[1]) * unit }
        };
    }

    const valueId = def.values.get(rawValue);
    if (!valueId) {
        const allowed = [...def.values.keys()].join(', ');
        throw new Error(
            `Value "${rawValue}" not found. Allowed values: ${allowed}`
        );
    }
    return {
        $type: t.field,
        id: def.pcfId,
        value: { $type: t.value, id: valueId }
    };
}

(async () => {
    const projectShort = getArg('--project');
    const summary = getArg('--summary');
    const dryRun = args.includes('--dry-run');

    if (!projectShort || !summary) {
        console.error('Usage: node create_issue.js --project <SHORTNAME> --summary "<title>" ');
        console.error('       [--desc "<text>" | --desc-file <path>] [--field "字段名=值"] [--dry-run]');
        process.exit(1);
    }

    let description = getArg('--desc');
    const descFile = getArg('--desc-file');
    if (descFile) {
        try {
            description = fs.readFileSync(descFile, 'utf8');
        } catch (err) {
            console.error(`Error: Cannot read description file: ${descFile}`);
            process.exit(1);
        }
    }

    try {
        const project = await resolveProject(projectShort);
        const fields = await resolveFields(project.id);

        const customFields = [];
        for (const pair of getAll('--field')) {
            const idx = pair.indexOf('=');
            if (idx === -1) {
                throw new Error(`--field expects "name=value", got "${pair}"`);
            }
            const name = pair.slice(0, idx).trim();
            const value = pair.slice(idx + 1).trim();
            const def = fields.get(name);
            if (!def) {
                const names = [...fields.keys()].join(', ');
                throw new Error(`Field "${name}" not found in project. Available: ${names}`);
            }
            customFields.push(await buildCustomField(def, value));
        }

        const payload = {
            $type: 'Issue',
            project: { $type: 'Project', id: project.id },
            summary
        };
        if (description) payload.description = description;
        if (customFields.length) payload.customFields = customFields;

        if (dryRun) {
            console.log('=== dry run, not submitted ===');
            console.log(JSON.stringify(payload, null, 2));
            return;
        }

        const result = await request(
            'POST',
            '/api/issues?fields=idReadable,summary,customFields(name,value(name,login))',
            payload
        );

        console.log(`Created ${result.idReadable}: ${result.summary}`);
        console.log(`URL: http://${YOUTRACK_HOST}:${YOUTRACK_PORT}/issue/${result.idReadable}`);
        for (const cf of result.customFields || []) {
            const v = cf.value;
            if (v === null || v === undefined) continue;
            const shown = Array.isArray(v)
                ? `[${v.map(x => x.name || x.login).join(', ')}]`
                : (v.name || v.login);
            console.log(`  ${cf.name}: ${shown}`);
        }
    } catch (err) {
        console.error(`Failed to create issue: ${err.message}`);
        process.exit(1);
    }
})();
