/**
 * 构建分析主流程
 * 整合所有模块，提供完整的构建分析功能
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseTeamcityUrl } = require('./parse-url');
const { TeamCityClient } = require('./api-client');
const { detectPlatform } = require('./platform-detector');
const {
    createSnippetAnalysisPrompt,
    createFullLogAnalysisPrompt,
    createFallbackAnalysisPrompt,
    parseAnalysisResult,
    formatAnalysisOutput,
    formatSuccessOutput,
    formatErrorOutput
} = require('./log-analyzer');

/**
 * 从 Claude Code 的 settings.json 读取环境变量
 * @param {string} envVar - 环境变量名
 * @returns {string|null} Token 值或 null
 */
function getTokenFromSettings(envVar) {
    try {
        // 获取 settings.json 路径
        // Windows: %USERPROFILE%\.claude\settings.json
        // Linux/Mac: ~/.claude/settings.json
        const homeDir = os.homedir();
        const settingsPath = path.join(homeDir, '.claude', 'settings.json');

        if (!fs.existsSync(settingsPath)) {
            return null;
        }

        const settingsContent = fs.readFileSync(settingsPath, 'utf8');
        const settings = JSON.parse(settingsContent);

        return settings.env?.[envVar] || null;
    } catch (error) {
        // 读取失败时静默返回 null
        return null;
    }
}

/**
 * 根据 CI 服务器地址获取对应的环境变量名称
 * @param {string} baseUrl - CI 服务器基础 URL
 * @returns {Object} { envVar: string, envName: string }
 */
function getCiEnvVariable(baseUrl) {
    const url = baseUrl.toLowerCase();

    if (url.includes('cdci.ispeco.com:90')) {
        return { envVar: 'SUPERMAP_CDCI_TOKEN', envName: 'SUPERMAP_CDCI_TOKEN (iSpeco CDCI)' };
    } else if (url.includes('ci.iserver.com:90') || url.includes('ci.ispeco.com:90')) {
        return { envVar: 'SUPERMAP_CI_TOKEN', envName: 'SUPERMAP_CI_TOKEN (iServer/iSpeco CI)' };
    }

    // 默认使用 SUPERMAP_CDCI_TOKEN
    return { envVar: 'SUPERMAP_CDCI_TOKEN', envName: 'SUPERMAP_CDCI_TOKEN' };
}

/**
 * 获取 CI Token，根据服务器地址自动选择环境变量
 * @param {string} baseUrl - CI 服务器基础 URL
 * @param {string} providedToken - 用户提供的 Token（可选）
 * @returns {string} Token 值
 */
function getCiToken(baseUrl, providedToken) {
    if (providedToken) {
        return providedToken;
    }

    const { envVar, envName } = getCiEnvVariable(baseUrl);

    // 优先从环境变量读取，其次从 settings.json 读取
    const token = process.env[envVar] || getTokenFromSettings(envVar);

    if (!token) {
        throw new Error(
            `未设置 ${envName} 环境变量\n\n` +
            `当前 CI 服务器: ${baseUrl}\n` +
            `请在以下位置之一设置 Token:\n\n` +
            `1. 系统环境变量:\n` +
            `   Windows: set ${envVar}=your_token_here\n` +
            `   Linux/Mac: export ${envVar}=your_token_here\n\n` +
            `2. Claude Code settings.json:\n` +
            `   在 ~/.claude/settings.json 中添加:\n` +
            `   "env": { "${envVar}": "your_token_here" }\n\n` +
            `环境变量对照表：\n` +
            '- cdci.ispeco.com:90 → SUPERMAP_CDCI_TOKEN\n' +
            '- ci.iserver.com:90 → SUPERMAP_CI_TOKEN\n' +
            '- ci.ispeco.com:90 → SUPERMAP_CI_TOKEN'
        );
    }

    return token;
}

/**
 * 从日志或分析结果中提取 Sonar 项目信息
 * @param {string} logContent - 日志内容
 * @param {Object} analysis - LLM 分析结果
 * @returns {Object|null} Sonar 项目信息或 null
 */
function extractSonarInfo(logContent, analysis) {
    const content = (logContent || '') + ' ' + JSON.stringify(analysis || {});

    // 检查是否包含 Sonar 相关关键词
    const sonarPatterns = [
        /sonar\.ispeco\.com/gi,
        /quality gate/gi,
        /质量门/gi,
        /sonarqube/gi,
        /sonarscanner/gi,
        /sonar:sonar/gi
    ];

    const hasSonarInfo = sonarPatterns.some(pattern => pattern.test(content));
    if (!hasSonarInfo) {
        return null;
    }

    // 尝试提取项目 key (格式: com.supermap.cloud:project-name)
    const projectKeyPattern = /(com\.supermap\.cloud:[\w-]+)/gi;
    const projectKeys = content.match(projectKeyPattern) || [];
    const projectKey = projectKeys.length > 0 ? projectKeys[0] : null;

    // 尝试提取 PR 号
    const prPatterns = [
        /pullRequest[=:]\s*(\d+)/gi,
        /pr[=:]?\s*(\d+)/gi,
        /PR\s*#?\s*(\d+)/gi,
        /Merge\s*request\s*[!#]?(\d+)/gi
    ];

    let prNumber = null;
    for (const pattern of prPatterns) {
        const match = content.match(pattern);
        if (match && match[1]) {
            prNumber = match[1];
            break;
        }
    }

    // 如果没有从日志提取到 PR 号，尝试从分析结果的 statusText 提取
    if (!prNumber && analysis && analysis.prNumber) {
        prNumber = analysis.prNumber;
    }

    return {
        hasSonarInfo: true,
        projectKey,
        prNumber,
        isQualityGateFailure: /quality gate|质量门|Quality Gate.*failed|质量门.*未通过/gi.test(content)
    };
}

/**
 * 构建 Sonar 分析 URL
 * @param {Object} sonarInfo - Sonar 项目信息
 * @returns {string} Sonar URL
 */
function buildSonarUrl(sonarInfo) {
    if (!sonarInfo.projectKey) {
        return null;
    }

    let url = `http://sonar.ispeco.com:9001/dashboard?id=${sonarInfo.projectKey}`;
    if (sonarInfo.prNumber) {
        url += `&pullRequest=${sonarInfo.prNumber}`;
    }
    return url;
}

/**
 * 分析 TeamCity 构建
 * @param {string} buildUrl - TeamCity 构建 URL
 * @param {Object} options - 选项
 * @param {Function} options.llmQuery - LLM 查询函数 (prompt) => Promise<string>
 * @param {string} options.token - TeamCity Token（可选，默认从环境变量读取）
 * @returns {Promise<string>} 分析结果
 */
async function analyzeBuild(buildUrl, options = {}) {
    try {
        // 1. 解析 URL
        const { baseUrl, buildTypeId, branch } = parseTeamcityUrl(buildUrl);

        // 2. 根据 CI 服务器地址获取对应 Token
        const token = getCiToken(baseUrl, options.token);

        // 3. 创建 API 客户端
        const client = new TeamCityClient(baseUrl, token);

        // 4. 获取最新构建状态（传入分支参数）
        const build = await client.getLatestBuild(buildTypeId, branch);

        // 5. 判断状态
        if (build.status === 'SUCCESS') {
            return formatSuccessOutput(build);
        }

        // 6. 构建失败，获取更多信息
        let logSnippet = '';
        let useFallbackAnalysis = false;

        try {
            // 6.1 尝试获取日志片段（最后 300 行）
            logSnippet = await client.getBuildLog(build.id, 300);
        } catch (logError) {
            // 日志获取失败，使用降级方案
            useFallbackAnalysis = true;
            // 获取其他可用信息
            try {
                const details = await client.getBuildDetails(build.id);
                const failedTests = await client.getFailedTests(build.id);
                const changes = await client.getChanges(build.id);

                // 构建降级分析信息
                logSnippet = buildFallbackLogSnippet(build, details, failedTests, changes);
            } catch (fallbackError) {
                // 即使降级也失败，使用最简单的信息
                logSnippet = buildMinimalLogSnippet(build);
            }
        }

        // 6.2 使用 LLM 分析
        const llmQuery = options.llmQuery;
        if (!llmQuery) {
            throw new Error('需要提供 llmQuery 函数来进行日志分析');
        }

        let finalAnalysis;

        if (useFallbackAnalysis) {
            // 使用降级分析 Prompt
            const fallbackPrompt = createFallbackAnalysisPrompt(logSnippet, build);
            const response = await llmQuery(fallbackPrompt);
            finalAnalysis = parseAnalysisResult(response);
        } else {
            // 正常流程：先分析片段
            const snippetPrompt = createSnippetAnalysisPrompt(logSnippet, build);
            const snippetResponse = await llmQuery(snippetPrompt);
            const snippetAnalysis = parseAnalysisResult(snippetResponse);

            // 判断是否需要完整日志
            if (snippetAnalysis.confidence === 'low' && !useFallbackAnalysis) {
                try {
                    const fullLog = await client.getBuildLog(build.id);
                    const fullPrompt = createFullLogAnalysisPrompt(fullLog, build);
                    const fullResponse = await llmQuery(fullPrompt);
                    finalAnalysis = parseAnalysisResult(fullResponse);
                } catch (fullLogError) {
                    // 完整日志获取失败，使用片段分析结果
                    finalAnalysis = snippetAnalysis;
                }
            } else {
                finalAnalysis = snippetAnalysis;
            }
        }

        // 6.3 Sonar 失败检测与联动分析
        let sonarAnalysisResult = null;
        const sonarInfo = extractSonarInfo(logSnippet, finalAnalysis);

        if (sonarInfo && sonarInfo.hasSonarInfo && sonarInfo.projectKey) {
            // 构建 Sonar URL
            const sonarUrl = buildSonarUrl(sonarInfo);
            if (sonarUrl && options.skillInvoker) {
                try {
                    // 调用 supermap:sonar_error_analysis skill
                    sonarAnalysisResult = await options.skillInvoker('supermap:sonar_error_analysis', sonarUrl);
                } catch (sonarError) {
                    // Sonar 分析失败，记录但不影响主流程
                    sonarAnalysisResult = null;
                }
            }
        }

        // 7. 检测平台
        const platform = detectPlatform();

        // 8. 格式化输出
        const output = formatAnalysisOutput(finalAnalysis, platform);

        // 9. 添加 Sonar 分析结果（如有）
        let result = `✗ 构建 #${build.number} 失败\n\n`;

        if (sonarAnalysisResult) {
            result += `【失败原因】\nCI 构建在 Sonar 质量门检查阶段失败\n\n`;
            result += `【Sonar 质量门分析】\n${sonarAnalysisResult}\n\n`;
            result += `【CI 构建解决方案】\n${output}`;
        } else {
            result += output;
        }

        // 10. 添加日志获取失败的提示
        if (useFallbackAnalysis) {
            result += '\n【提示】无法获取完整构建日志，分析基于可用信息。建议直接访问 TeamCity 查看详细日志。\n';
        }

        return result;

    } catch (error) {
        return formatErrorOutput(error.message);
    }
}

/**
 * 构建降级日志片段
 */
function buildFallbackLogSnippet(build, details, failedTests, changes, buildSteps, buildParameters) {
    let snippet = `【构建信息】\n`;
    snippet += `- 构建编号: #${build.number}\n`;
    snippet += `- 状态: ${build.status}\n`;
    snippet += `- 状态文本: ${build.statusText || 'N/A'}\n\n`;

    if (details && details.statusText) {
        snippet += `【状态详情】\n${details.statusText}\n\n`;
    }

    // 展开问题详情（包含 details 字段）
    if (failedTests && failedTests.problems && failedTests.problems.length > 0) {
        snippet += `【问题列表】\n`;
        failedTests.problems.forEach((p, i) => {
            snippet += `${i + 1}. [${p.type || 'Unknown'}] ${p.details || p.identity || 'N/A'}\n`;
        });
        snippet += `\n`;
    }

    if (failedTests && failedTests.failedTests && failedTests.failedTests.length > 0) {
        snippet += `【失败测试】\n`;
        failedTests.failedTests.slice(0, 5).forEach((t, i) => {
            snippet += `${i + 1}. ${t.name || 'Unknown Test'}\n`;
        });
        snippet += `\n`;
    }

    // 构建步骤定义
    if (buildSteps && buildSteps.step && buildSteps.step.length > 0) {
        snippet += `【构建步骤】\n`;
        buildSteps.step.forEach((s, i) => {
            const props = {};
            if (s.properties && s.properties.property) {
                s.properties.property.forEach(p => {
                    props[p.name] = p.value;
                });
            }
            snippet += `${i + 1}. [${s.id}] ${s.name} (type: ${s.type})\n`;
            // 显示关键配置：goals、pomLocation、runnerArgs
            if (props.goals) snippet += `   goals: ${props.goals}\n`;
            if (props.pomLocation) snippet += `   pomLocation: ${props.pomLocation}\n`;
            if (props.runnerArgs) snippet += `   runnerArgs: ${props.runnerArgs}\n`;
        });
        snippet += `\n`;
    }

    // 构建参数（只显示与失败相关的关键参数）
    if (buildParameters && buildParameters.relevant) {
        const relevantParams = Object.keys(buildParameters.relevant);
        if (relevantParams.length > 0) {
            snippet += `【关键构建参数】\n`;
            relevantParams.forEach(k => {
                // 截断过长的值
                const val = buildParameters.relevant[k];
                snippet += `- ${k}: ${val.length > 300 ? val.substring(0, 300) + '...' : val}\n`;
            });
            snippet += `\n`;
        }
    }

    if (changes && changes.length > 0) {
        snippet += `【最近变更】\n`;
        changes.slice(0, 3).forEach((c, i) => {
            snippet += `${i + 1}. ${c.username || 'Unknown'}: ${(c.comment || '').substring(0, 100)}\n`;
        });
    }

    return snippet;
}

/**
 * 构建最小化日志片段
 */
function buildMinimalLogSnippet(build) {
    return `【构建信息】
- 构建编号: #${build.number}
- 状态: ${build.status}
- 状态文本: ${build.statusText || 'N/A'}

无法获取更详细的日志信息。建议基于状态文本分析失败原因。`;
}

/**
 * 快速分析构建（简化版，仅返回状态）
 * @param {string} buildUrl - TeamCity 构建 URL
 * @param {string} token - TeamCity Token（可选）
 * @returns {Promise<Object>} 构建状态信息
 */
async function getBuildStatus(buildUrl, token) {
    try {
        const { baseUrl, buildTypeId, branch } = parseTeamcityUrl(buildUrl);
        const authToken = getCiToken(baseUrl, token);
        const client = new TeamCityClient(baseUrl, authToken);
        const build = await client.getLatestBuild(buildTypeId, branch);

        return {
            success: true,
            buildNumber: build.number,
            status: build.status,
            statusText: build.statusText,
            webUrl: build.webUrl,
            finishDate: build.finishOnAgentDate
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * 获取原始构建数据（供 Claude 分析）
 * @param {string} buildUrl - TeamCity 构建 URL
 * @param {string} token - TeamCity Token（可选）
 * @returns {Promise<Object>} 原始构建数据
 */
async function getRawBuildData(buildUrl, token) {
    const { baseUrl, buildTypeId, branch } = parseTeamcityUrl(buildUrl);
    const authToken = getCiToken(baseUrl, token);
    const client = new TeamCityClient(baseUrl, authToken);

    const build = await client.getLatestBuild(buildTypeId, branch);

    // 获取日志（最后 500 行）
    let logContent = '';
    try {
        logContent = await client.getBuildLog(build.id, 500);
    } catch (e) {
        logContent = `获取日志失败: ${e.message}`;
    }

    // 获取失败测试和问题
    const failedTests = await client.getFailedTests(build.id);

    // 获取变更
    const changes = await client.getChanges(build.id);

    // 获取构建步骤定义
    const buildSteps = await client.getBuildSteps(buildTypeId);

    // 获取构建参数
    const buildParameters = await client.getBuildParameters(build.id);

    return {
        build: {
            id: build.id,
            number: build.number,
            status: build.status,
            statusText: build.statusText,
            buildTypeId: build.buildTypeId,
            webUrl: build.webUrl,
            finishOnAgentDate: build.finishOnAgentDate
        },
        logContent,
        failedTests,
        buildSteps,
        buildParameters,
        changes
    };
}

/**
 * 列出构建产物
 * @param {string} buildUrl - TeamCity 构建 URL
 * @param {string} token - TeamCity Token（可选）
 * @returns {Promise<Array>} 产物列表
 */
async function listBuildArtifacts(buildUrl, token) {
    const { baseUrl, buildTypeId, branch } = parseTeamcityUrl(buildUrl);
    const authToken = getCiToken(baseUrl, token);
    const client = new TeamCityClient(baseUrl, authToken);

    const build = await client.getLatestBuild(buildTypeId, branch);
    const artifacts = await client.listArtifacts(build.id);
    return artifacts;
}

/**
 * 读取构建产物内容
 * @param {string} buildUrl - TeamCity 构建 URL
 * @param {string} artifactPath - 产物路径
 * @param {string} token - TeamCity Token（可选）
 * @returns {Promise<string>} 产物内容
 */
async function readBuildArtifact(buildUrl, artifactPath, token) {
    const { baseUrl, buildTypeId, branch } = parseTeamcityUrl(buildUrl);
    const authToken = getCiToken(baseUrl, token);
    const client = new TeamCityClient(baseUrl, authToken);

    const build = await client.getLatestBuild(buildTypeId, branch);
    const content = await client.readArtifact(build.id, artifactPath);
    return content;
}

module.exports = {
    analyzeBuild,
    getBuildStatus,
    getRawBuildData,
    listBuildArtifacts,
    readBuildArtifact,
    getCiEnvVariable,
    getCiToken,
    extractSonarInfo,
    buildSonarUrl
};

// CLI 入口 - 直接运行脚本
if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
        console.log(`
TeamCity 构建分析工具

使用方法:
  node analyze-build.js <TeamCity URL> [options]

参数:
  <TeamCity URL>  TeamCity 构建配置 URL

选项:
  --raw, -r            原始数据模式：输出构建信息和日志（JSON格式），供Claude分析
  --list-artifacts     列出构建产物文件
  --artifact <path>    读取指定构建产物内容
  --help, -h           显示帮助信息

环境变量:
  SUPERMAP_CDCI_TOKEN  - 用于 cdci.ispeco.com:90
  SUPERMAP_CI_TOKEN    - 用于 ci.iserver.com:90 或 ci.ispeco.com:90

示例:
  # 获取原始构建数据（Claude分析模式）
  node analyze-build.js "http://cdci.ispeco.com:90/buildConfiguration/MyProject_Build" --raw

  # 列出构建产物
  node analyze-build.js "http://ci.iserver.com:90/buildConfiguration/MyProject_Build" --list-artifacts

  # 读取指定构建产物
  node analyze-build.js "http://ci.iserver.com:90/buildConfiguration/MyProject_Build" --artifact dependency-check-report.xml
`);
        process.exit(0);
    }

    const buildUrl = args[0];
    const rawMode = args.includes('--raw') || args.includes('-r');
    const listArtifactsMode = args.includes('--list-artifacts');
    const artifactIndex = args.indexOf('--artifact');
    const artifactPath = artifactIndex !== -1 && artifactIndex + 1 < args.length ? args[artifactIndex + 1] : null;

    // 收集所有被 --artifact 或 --list-artifacts 占用的参数索引，排除它们后找 token
    const consumedIndices = new Set([0]);
    if (rawMode) consumedIndices.add(args.indexOf('--raw'));
    if (listArtifactsMode) consumedIndices.add(args.indexOf('--list-artifacts'));
    if (artifactIndex !== -1) {
      consumedIndices.add(artifactIndex);
      if (artifactIndex + 1 < args.length) consumedIndices.add(artifactIndex + 1);
    }
    const token = args.find((arg, i) => !consumedIndices.has(i) && !arg.startsWith('--') && !arg.startsWith('http')) || null;

    if (listArtifactsMode) {
        listBuildArtifacts(buildUrl, token).then(files => {
            console.log(JSON.stringify(files.map(f => ({
                name: f.name,
                size: f.size,
                modificationTime: f.modificationTime
            })), null, 2));
        }).catch(error => {
            console.error(JSON.stringify({ error: error.message }));
            process.exit(1);
        });
        return;
    }

    if (artifactPath) {
        readBuildArtifact(buildUrl, artifactPath, token).then(content => {
            process.stdout.write(content);
        }).catch(error => {
            console.error(JSON.stringify({ error: error.message }));
            process.exit(1);
        });
        return;
    }

    if (rawMode) {
        // 原始数据模式：输出 JSON 供 Claude 分析
        getRawBuildData(buildUrl, token).then(data => {
            console.log(JSON.stringify(data, null, 2));
        }).catch(error => {
            console.error(JSON.stringify({ error: error.message }));
            process.exit(1);
        });
    } else {
        console.log(`
请使用 --raw 参数获取构建数据供分析：

  node analyze-build.js "${buildUrl}" --raw

或使用以下命令在 Claude Code 中分析：
  cd ~/.claude/skills/supermap-cdci-analysis/scripts
  node analyze-build.js "${buildUrl}" --raw
`);
    }
}
