/**
 * TeamCity API 客户端
 * 使用 Node.js 原生 https 模块调用 TeamCity REST API
 */

const https = require('https');
const http = require('http');

/**
 * 认证方式枚举
 */
const AuthMethod = {
    BEARER: 'bearer',
    BASIC_TOKEN: 'basic_token',    // -u :token
    BASIC_USERNAME: 'basic_user',  // -u token:
    BASIC_EMPTY: 'basic_empty'     // -u " :token"
};

/**
 * 通用 HTTP 请求函数
 * @param {string|URL} url - 请求 URL
 * @param {Object} options - 请求选项
 * @returns {Promise<string>} 响应内容
 */
function makeRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        // 将 URL 对象转换为字符串
        const urlString = url instanceof URL ? url.toString() : url;
        const client = urlString.startsWith('https:') ? https : http;
        const req = client.request(urlString, options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(data);
                } else {
                    const error = new Error(`HTTP ${res.statusCode}`);
                    error.statusCode = res.statusCode;
                    error.data = data;
                    reject(error);
                }
            });
        });

        req.on('error', reject);

        if (options.timeout) {
            req.setTimeout(options.timeout);
        }

        if (options.body) {
            req.write(options.body);
        }

        req.end();
    });
}

/**
 * TeamCity API 客户端
 * 支持多种认证方式，自动回退
 */
class TeamCityClient {
    /**
     * @param {string} baseUrl - TeamCity 服务器基础 URL
     * @param {string} token - 访问 Token
     */
    constructor(baseUrl, token) {
        this.baseUrl = baseUrl.replace(/\/$/, ''); // 移除末尾斜杠
        this.token = this._sanitizeToken(token);    // 清理 Token 中的空白字符
        this.authMethod = null; // 缓存成功的认证方式
    }

    /**
     * 清理 Token，去除空白字符
     * @param {string} token - 原始 Token
     * @returns {string} 清理后的 Token
     */
    _sanitizeToken(token) {
        if (!token) return '';
        // 去除所有类型的空白字符（空格、换行、回车、制表符等）
        return token.replace(/\s/g, '');
    }

    /**
     * 获取 URL 对象
     * @param {string} path - URL 路径
     * @returns {URL} URL 对象
     */
    _getUrl(path) {
        // 确保 path 以 / 开头
        const normalizedPath = path.startsWith('/') ? path : `/${path}`;
        return new URL(normalizedPath, this.baseUrl);
    }

    /**
     * 构建请求选项（包含认证头）
     * @param {string} method - 认证方式
     * @returns {Object} 请求选项
     */
    _buildRequestOptions(method, extraOptions = {}) {
        const options = {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                ...extraOptions.headers
            },
            ...extraOptions
        };

        switch (method) {
            case AuthMethod.BEARER:
                options.headers['Authorization'] = `Bearer ${this.token}`;
                break;
            case AuthMethod.BASIC_TOKEN:
                // 空用户名 + token 作为密码
                options.headers['Authorization'] = `Basic ${Buffer.from(`:${this.token}`).toString('base64')}`;
                break;
            case AuthMethod.BASIC_USERNAME:
                // token 作为用户名 + 空密码
                options.headers['Authorization'] = `Basic ${Buffer.from(`${this.token}:`).toString('base64')}`;
                break;
            case AuthMethod.BASIC_EMPTY:
                // 空格用户名 + token 作为密码
                options.headers['Authorization'] = `Basic ${Buffer.from(` :${this.token}`).toString('base64')}`;
                break;
            default:
                options.headers['Authorization'] = `Bearer ${this.token}`;
        }

        return options;
    }

    /**
     * 检测认证方式是否成功
     * @param {string} method - 认证方式
     * @returns {Promise<boolean>} 是否成功
     */
    async _testAuthMethod(method) {
        try {
            const url = this._getUrl('/app/rest/server');
            const options = this._buildRequestOptions(method, { timeout: 10000 });
            await makeRequest(url, options);
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * 检测并缓存最佳认证方式
     * @returns {Promise<string>} 成功的认证方式
     */
    async _detectBestAuthMethod() {
        // 如果已经缓存，直接返回
        if (this.authMethod) {
            return this.authMethod;
        }

        // 尝试顺序（基于 TeamCity 常见配置）
        const methods = [
            AuthMethod.BEARER,
            AuthMethod.BASIC_TOKEN,
            AuthMethod.BASIC_USERNAME,
            AuthMethod.BASIC_EMPTY
        ];

        for (const method of methods) {
            if (await this._testAuthMethod(method)) {
                this.authMethod = method;
                return method;
            }
        }

        // 默认使用 Bearer（让后续请求报错）
        return AuthMethod.BEARER;
    }

    /**
     * 执行 HTTP 请求（支持多认证方式回退）
     * @param {string} url - 请求 URL
     * @param {Object} options - 选项
     * @returns {Promise<string>} 响应内容
     */
    async _executeRequest(url, options = {}) {
        const { timeout = 30000 } = options;

        // 检测最佳认证方式
        const authMethod = await this._detectBestAuthMethod();
        const requestOptions = this._buildRequestOptions(authMethod, { timeout, ...options });

        try {
            return await makeRequest(url, requestOptions);
        } catch (error) {
            // 认证失败，尝试其他方式
            if (error.statusCode === 401) {
                // 重置认证方式缓存，下次重新检测
                this.authMethod = null;

                // 如果当前是 Bearer，尝试 Basic
                if (authMethod === AuthMethod.BEARER) {
                    return await this._executeRequestWithBasicAuth(url, options);
                }

                throw new Error('认证失败 (401): Token 无效或已过期，请检查 SUPERMAP_CDCI_TOKEN 环境变量\n' +
                    '已尝试认证方式: Bearer Token, Basic Auth');
            }

            if (error.statusCode === 404) {
                throw new Error('资源不存在 (404): 请检查构建配置 ID 是否正确');
            }

            throw new Error(`API 请求失败: ${error.message}`);
        }
    }

    /**
     * 使用 Basic Auth 重试请求
     * @param {string} url - 请求 URL
     * @param {Object} options - 选项
     * @returns {Promise<string>} 响应内容
     */
    async _executeRequestWithBasicAuth(url, options = {}) {
        const { timeout = 30000 } = options;

        // 尝试多种 Basic Auth 格式
        const basicMethods = [
            AuthMethod.BASIC_TOKEN,    // 空用户名
            AuthMethod.BASIC_USERNAME, // token 作为用户名
            AuthMethod.BASIC_EMPTY     // 空格用户名
        ];

        for (const method of basicMethods) {
            try {
                const requestOptions = this._buildRequestOptions(method, { timeout, ...options });
                const result = await makeRequest(url, requestOptions);

                // 检查是否真的是 JSON 响应（而非登录页面）
                if (result.startsWith('{') || result.startsWith('[') || result.includes('"')) {
                    // 缓存成功的认证方式
                    this.authMethod = method;
                    return result;
                }
            } catch (error) {
                // 继续尝试下一种
                continue;
            }
        }

        throw new Error('所有认证方式均失败，请检查 Token 是否有效');
    }

    /**
     * 获取最新构建状态
     * @param {string} buildTypeId - 构建类型 ID
     * @param {string} branch - 分支名称（可选）
     * @returns {Promise<Object>} 构建信息
     */
    async getLatestBuild(buildTypeId, branch = null) {
        // 构建 locator，如果提供了分支则添加分支过滤
        let locator = `buildType:${buildTypeId}`;
        if (branch) {
            locator += `,branch:${branch}`;
        }
        locator += ',count:1';

        const url = this._getUrl(`/app/rest/builds?locator=${locator}&fields=build(id,number,status,statusText,buildTypeId,webUrl,state,finishOnAgentDate)`);

        const output = await this._executeRequest(url);

        try {
            const data = JSON.parse(output);

            if (!data.build || data.build.length === 0) {
                throw new Error('未找到构建记录，该构建配置可能从未运行过');
            }

            return data.build[0];
        } catch (error) {
            if (error.message.includes('未找到')) {
                throw error;
            }
            throw new Error(`解析 API 响应失败: ${error.message}`);
        }
    }

    /**
     * 获取构建日志（支持多认证方式）
     * @param {string} buildId - 构建 ID
     * @param {number} tailLines - 获取最后多少行（可选，不传则获取完整日志）
     * @returns {Promise<string>} 日志内容
     */
    async getBuildLog(buildId, tailLines = null) {
        // 尝试多种方式获取日志
        // 注意：TeamCity REST API 的 /log 端点和 /artifacts/content/.teamcity/buildLog.txt
        // 端点在很多 TeamCity 版本中不可用，优先使用 /downloadBuildLog.html
        const methods = [
            // 方式1: 通过下载链接获取（最可靠）
            async () => await this._getLogFromDownload(buildId, tailLines),
            // 方式2: 获取构建消息作为替代
            async () => await this._getBuildMessages(buildId)
        ];

        let lastError = null;

        for (const method of methods) {
            try {
                const result = await method();
                if (result && result.length > 0) {
                    return result;
                }
            } catch (error) {
                lastError = error;
                // 继续尝试下一种方式
            }
        }

        // 所有方法都失败，返回友好提示
        if (lastError) {
            throw new Error(`无法获取构建日志: ${lastError.message}\n\n` +
                '可能原因:\n' +
                '1. Token 权限不足（无法访问日志端点）\n' +
                '2. 构建日志已被清理\n' +
                '3. TeamCity 版本不支持该端点\n\n' +
                '建议: 直接访问 TeamCity Web 界面查看日志');
        }

        return '';
    }

    /**
     * 通过下载链接获取日志
     */
    async _getLogFromDownload(buildId, tailLines) {
        const url = this._getUrl(`/downloadBuildLog.html?buildId=${buildId}`);
        const authMethod = await this._detectBestAuthMethod();

        // 日志下载端点返回纯文本，需要设置 Accept: text/plain
        // 避免使用默认的 application/json 导致 406 错误
        const requestOptions = this._buildRequestOptions(authMethod, {
            timeout: 120000,
            headers: {
                'Accept': 'text/plain'
            }
        });

        const output = await makeRequest(url, requestOptions);

        // 检查是否返回了登录页面（HTML 而非日志）
        if (output.includes('<html') || output.includes('<!DOCTYPE')) {
            throw new Error('返回了登录页面而非日志内容');
        }

        if (tailLines && tailLines > 0) {
            const lines = output.split('\n');
            return lines.slice(-tailLines).join('\n');
        }

        return output;
    }

    /**
     * 获取构建消息作为日志替代
     */
    async _getBuildMessages(buildId) {
        const url = this._getUrl(`/app/rest/builds/id:${buildId}/messages`);
        const output = await this._executeRequest(url, { timeout: 30000 });

        // 尝试解析 JSON 消息
        try {
            const data = JSON.parse(output);
            if (data.messages && Array.isArray(data.messages)) {
                return data.messages.map(m => m.text || '').join('\n');
            }
        } catch (e) {
            // 返回原始内容
        }

        return output;
    }

    /**
     * 获取失败测试详情（增强版）
     * @param {string} buildId - 构建 ID
     * @returns {Promise<Object>} 包含失败测试和统计信息
     */
    async getFailedTests(buildId) {
        try {
            // 获取测试统计
            const statsUrl = this._getUrl(`/app/rest/testOccurrences?locator=build:(id:${buildId})&fields=count,passed,failed,ignored`);
            const statsOutput = await this._executeRequest(statsUrl);
            const stats = JSON.parse(statsOutput);

            // 获取失败测试详情（包含 details/stacktrace）
            const failedUrl = this._getUrl(`/app/rest/testOccurrences?locator=build:(id:${buildId}),status:FAILURE&fields=testOccurrence(id,name,status,duration,details,stacktrace,test(id,name))`);
            const failedOutput = await this._executeRequest(failedUrl);
            const failedData = JSON.parse(failedOutput);

            // 获取问题详情（包含 details 字段）
            const problemUrl = this._getUrl(`/app/rest/problemOccurrences?locator=build:(id:${buildId})&fields=problemOccurrence(id,type,identity,details,problem,build)`);
            let problems = [];
            try {
                const problemOutput = await this._executeRequest(problemUrl);
                const problemData = JSON.parse(problemOutput);
                problems = problemData.problemOccurrence || [];
            } catch (e) {
                // 忽略问题查询错误
            }

            return {
                stats: {
                    total: stats.count || 0,
                    passed: stats.passed || 0,
                    failed: stats.failed || 0,
                    ignored: stats.ignored || 0
                },
                failedTests: failedData.testOccurrence || [],
                problems: problems
            };
        } catch (error) {
            // 返回空结构
            return {
                stats: { total: 0, passed: 0, failed: 0, ignored: 0 },
                failedTests: [],
                problems: []
            };
        }
    }

    /**
     * 获取变更详情
     * @param {string} buildId - 构建 ID
     * @returns {Promise<Array>} 变更列表
     */
    async getChanges(buildId) {
        try {
            const url = this._getUrl(`/app/rest/changes?locator=build:(id:${buildId})`);
            const output = await this._executeRequest(url);
            const data = JSON.parse(output);
            return data.change || [];
        } catch (error) {
            return [];
        }
    }

    /**
     * 获取构建详情
     * @param {string} buildId - 构建 ID
     * @returns {Promise<Object>} 构建详情
     */
    async getBuildDetails(buildId) {
        try {
            const url = this._getUrl(`/app/rest/builds/id:${buildId}`);
            const output = await this._executeRequest(url);
            return JSON.parse(output);
        } catch (error) {
            throw new Error(`获取构建详情失败: ${error.message}`);
        }
    }

    /**
     * 获取构建类型的步骤定义
     * @param {string} buildTypeId - 构建类型 ID
     * @returns {Promise<Object>} 步骤定义
     */
    async getBuildSteps(buildTypeId) {
        try {
            const url = this._getUrl(`/app/rest/buildTypes/id:${buildTypeId}/steps`);
            const output = await this._executeRequest(url);
            return JSON.parse(output);
        } catch (error) {
            // 返回空结构
            return { count: 0, step: [] };
        }
    }

    /**
     * 列出构建产物
     * @param {string} buildId - 构建 ID
     * @returns {Promise<Array>} 产物文件列表
     */
    async listArtifacts(buildId) {
        try {
            const url = this._getUrl(`/app/rest/builds/id:${buildId}/artifacts/children/`);
            const output = await this._executeRequest(url, {
                timeout: 30000,
                headers: { 'Accept': 'application/json' }
            });
            const data = JSON.parse(output);
            return data.file || [];
        } catch (error) {
            throw new Error(`获取构建产物列表失败: ${error.message}`);
        }
    }

    /**
     * 读取构建产物内容
     * @param {string} buildId - 构建 ID
     * @param {string} artifactPath - 产物路径（如 dependency-check-report.xml）
     * @returns {Promise<string>} 产物内容
     */
    async readArtifact(buildId, artifactPath) {
        const cleanPath = artifactPath.replace(/^\/+/, '');
        const url = this._getUrl(`/app/rest/builds/id:${buildId}/artifacts/content/${cleanPath}`);
        try {
            return await this._executeRequest(url, {
                timeout: 120000,
                headers: { 'Accept': '*/*' }
            });
        } catch (error) {
            throw new Error(`读取构建产物 ${artifactPath} 失败: ${error.message}`);
        }
    }

    /**
     * 获取构建参数（结果属性）
     * 只保留与构建分析相关的关键参数，避免返回大量环境噪音
     * @param {string} buildId - 构建 ID
     * @returns {Promise<Object>} 构建参数
     */
    async getBuildParameters(buildId) {
        try {
            const url = this._getUrl(`/app/rest/builds/id:${buildId}/resulting-properties`);
            const output = await this._executeRequest(url);
            const data = JSON.parse(output);
            // 将 property 数组转换为对象，并过滤出关键参数
            const allProps = {};
            const relevantProps = {};
            if (data.property && Array.isArray(data.property)) {
                for (const p of data.property) {
                    if (p.name && p.value !== undefined) {
                        allProps[p.name] = p.value;
                    }
                }
            }

            // 只保留与构建分析相关的参数
            const relevantKeys = [
                // Sonar 相关
                'SONAR_GATE_GOAL', 'SONAR_GOAL_COMMON', 'VERIFY_SONAR_STATUS',
                'system.SONAR9001_ADDRESS', 'system.SONAR9000_ADDRESS', 'system.SONAR9600_ADDRESS',
                // 模块开关
                'ibase-modules', 'iserver-modules', 'iportal-modules', 'iexpress-modules',
                'providers-ugc', 'providers-mapping-localtiles', 'providers-mapping-remotetiles',
                'providers-realspace-tiles', 'services-ogc', 'services-rest',
                'services-rest-management', 'services-security', 'tilesource-impl',
                'ispeco-parent',
                // 测试控制
                'SKIP_TESTS',
                // 步骤状态
                'teamcity.build.step.status.RUNNER_1068',
                'teamcity.build.step.status.RUNNER_1069',
                'teamcity.build.step.status.RUNNER_1079',
                'teamcity.build.step.status.RUNNER_1322',
                'teamcity.build.step.status.RUNNER_1408',
                'teamcity.build.step.status.RUNNER_1587',
                'teamcity.build.step.status.RUNNER_1802',
                // PR 信息
                'teamcity.pullRequest.number', 'teamcity.pullRequest.source.branch',
                'teamcity.pullRequest.target.branch', 'teamcity.pullRequest.title',
                // 构建 ID
                'teamcity.build.id'
            ];

            for (const key of relevantKeys) {
                if (allProps[key]) {
                    relevantProps[key] = allProps[key];
                }
            }

            // 扫描所有属性，收集 teamcity.build.step.status.* 的值
            for (const key of Object.keys(allProps)) {
                if (key.startsWith('teamcity.build.step.status.') && !relevantProps[key]) {
                    relevantProps[key] = allProps[key];
                }
            }

            return { relevant: relevantProps };
        } catch (error) {
            return { relevant: {} };
        }
    }
}

module.exports = { TeamCityClient, AuthMethod };
