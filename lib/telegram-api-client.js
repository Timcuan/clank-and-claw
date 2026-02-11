import https from 'https';

const DEFAULT_TELEGRAM_ORIGIN = 'https://api.telegram.org';
const DEFAULT_TIMEOUT_MS = 30000;

const normalizeBaseUrl = (value) => String(value || '').trim().replace(/\/+$/, '');

const parseOrigins = ({ apiBases, apiBase }) => {
    if (Array.isArray(apiBases)) {
        const normalized = apiBases.map(normalizeBaseUrl).filter(Boolean);
        if (normalized.length > 0) return [...new Set(normalized)];
    }

    const csv = String(apiBases || '')
        .split(',')
        .map(normalizeBaseUrl)
        .filter(Boolean);
    if (csv.length > 0) return [...new Set(csv)];

    const fallback = normalizeBaseUrl(apiBase) || DEFAULT_TELEGRAM_ORIGIN;
    return [fallback];
};

const toErrorResult = (responseData, statusCode, origin) => ({
    ok: false,
    error: responseData,
    description: responseData,
    error_code: statusCode,
    _httpStatus: statusCode,
    _apiOrigin: origin
});

export const createTelegramApiClient = ({
    botToken,
    apiBases,
    apiBase,
    fileBase,
    agent,
    isRetryable = () => false,
    requestFn = https.request,
    sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)),
    defaultTimeoutMs = DEFAULT_TIMEOUT_MS
} = {}) => {
    const origins = parseOrigins({ apiBases, apiBase });
    const normalizedFileBase = normalizeBaseUrl(fileBase);
    let activeOriginIndex = 0;

    const buildApiUrl = (origin, method) => `${normalizeBaseUrl(origin)}/bot${botToken}/${method}`;
    const buildFileUrl = (origin, filePath) => {
        const base = normalizedFileBase || `${normalizeBaseUrl(origin)}/file`;
        return `${base}/bot${botToken}/${filePath}`;
    };

    const apiCallAtOrigin = async (origin, method, data = {}, timeoutMs = defaultTimeoutMs) => {
        return await new Promise((resolve, reject) => {
            const body = JSON.stringify(data);
            const req = requestFn(buildApiUrl(origin, method), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body)
                },
                agent,
                timeout: timeoutMs
            }, (res) => {
                let responseData = '';
                res.on('data', chunk => responseData += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(responseData);
                        resolve({
                            ...parsed,
                            _httpStatus: res.statusCode,
                            _apiOrigin: origin
                        });
                    } catch {
                        resolve(toErrorResult(responseData, res.statusCode, origin));
                    }
                });
            });

            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });
            req.write(body);
            req.end();
        });
    };

    const apiCall = async (method, data = {}, retries = 3) => {
        const totalAttempts = Math.max(1, retries, origins.length);
        for (let attempt = 1; attempt <= totalAttempts; attempt++) {
            const originIndex = (activeOriginIndex + attempt - 1) % origins.length;
            const apiOrigin = origins[originIndex];
            try {
                const result = await apiCallAtOrigin(apiOrigin, method, data, defaultTimeoutMs);

                if (result?.ok !== false) {
                    activeOriginIndex = originIndex;
                    return result;
                }

                if (isRetryable(result) && attempt < totalAttempts) {
                    const retryAfter = Number(result?.parameters?.retry_after || 0);
                    const delayMs = result?.error_code === 429
                        ? Math.max(1000, retryAfter * 1000)
                        : 1000 * attempt;
                    await sleep(delayMs);
                    continue;
                }

                activeOriginIndex = originIndex;
                return result;
            } catch (error) {
                if (attempt === totalAttempts) throw error;
                await sleep(1000 * attempt);
            }
        }

        throw new Error(`Telegram API call failed after ${totalAttempts} attempts`);
    };

    return {
        apiCall,
        apiCallAtOrigin,
        buildFileUrl,
        getOrigins: () => [...origins],
        getActiveOrigin: () => origins[activeOriginIndex] || origins[0],
        getFileBase: () => normalizedFileBase || ''
    };
};

export default {
    createTelegramApiClient
};
