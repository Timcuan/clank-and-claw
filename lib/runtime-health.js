const DEFAULT_RPC_URL = 'https://mainnet.base.org';
const DEFAULT_RPC_HEALTH_TIMEOUT_MS = 10000;

const parseCsvValues = (value) => (String(value || ''))
    .split(',')
    .map(s => String(s || '').trim())
    .filter(Boolean);

export const formatHealthError = (value) => String(value || 'unknown error').replace(/\s+/g, ' ').trim();

export const listEnabledIpfsProviders = (status) => {
    const providers = [];
    if (status?.kuboLocal) providers.push('Kubo Local');
    if (status?.pinata) providers.push('Pinata');
    if (status?.infura) providers.push('Infura (Legacy)');
    if (status?.nftStorage) providers.push('NFT.Storage Classic (Legacy)');
    return providers;
};

export const getStatusRpcCandidates = (options = {}) => {
    const configuredPrimary = String(options.primaryRpcUrl || '').trim();
    const candidates = [
        configuredPrimary || options.defaultRpcUrl || DEFAULT_RPC_URL,
        ...parseCsvValues(options.fallbackRpcUrlsCsv)
    ].filter(Boolean);
    return [...new Set(candidates)];
};

export const probeTelegramOrigin = async (origin, apiCallAtOrigin) => {
    const startedAt = Date.now();
    try {
        const result = await apiCallAtOrigin(origin, 'getMe');
        const latencyMs = Date.now() - startedAt;
        if (result?.ok) {
            return { origin, ok: true, latencyMs, username: result?.result?.username || null };
        }
        return {
            origin,
            ok: false,
            latencyMs,
            error: formatHealthError(result?.description || result?.error || `HTTP ${result?._httpStatus || 'unknown'}`)
        };
    } catch (error) {
        return {
            origin,
            ok: false,
            latencyMs: Date.now() - startedAt,
            error: formatHealthError(error?.message)
        };
    }
};

export const probeRpcEndpoint = async (rpcUrl, viemFactory, timeoutMs = DEFAULT_RPC_HEALTH_TIMEOUT_MS) => {
    const startedAt = Date.now();
    try {
        const client = viemFactory.createPublicClient({
            chain: viemFactory.base,
            transport: viemFactory.http(rpcUrl, {
                timeout: timeoutMs,
                retryCount: 0
            })
        });
        const blockNumber = await client.getBlockNumber();
        return {
            rpcUrl,
            ok: true,
            latencyMs: Date.now() - startedAt,
            blockNumber: blockNumber.toString()
        };
    } catch (error) {
        return {
            rpcUrl,
            ok: false,
            latencyMs: Date.now() - startedAt,
            error: formatHealthError(error?.message)
        };
    }
};

export default {
    formatHealthError,
    listEnabledIpfsProviders,
    getStatusRpcCandidates,
    probeTelegramOrigin,
    probeRpcEndpoint
};
