import type { ApiHeaderConfig, SearchConfig, PlayerRank, MatchScoreResult } from '../types';

export interface QueryResult<T> {
  data: T[];
  updatedAt?: string;
}

const QUERY_CACHE = new Map<string, { result: QueryResult<unknown>; timestamp: number }>();
const MEMORY_CACHE_TTL = 5 * 60 * 1000;
export const clearQueryCache = () => QUERY_CACHE.clear();

async function queryApi<T>(endpoint: string, params: Record<string, unknown>, onProgress: (msg: string, progress: number) => void): Promise<QueryResult<T>> {
  const url = new URL(endpoint, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  const key = url.toString();
  const cached = QUERY_CACHE.get(key);
  if (cached && Date.now() - cached.timestamp < MEMORY_CACHE_TTL) return cached.result as QueryResult<T>;

  onProgress('正在查询', 15);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(res.status === 401 || res.status === 403 ? '当前查询无权限，请联系管理员。' : `查询服务暂时不可用（${res.status}），请稍后重试。`);
    }
    onProgress('正在接收结果', 70);
    const json = await res.json();
    if (!json || !Array.isArray(json.data)) throw new Error('查询结果格式异常，请稍后重试。');
    const result: QueryResult<T> = { data: json.data, updatedAt: json.updatedAt };
    QUERY_CACHE.set(key, { result, timestamp: Date.now() });
    onProgress('查询完成', 100);
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('查询超时，请检查网络后重试。');
    if (error instanceof SyntaxError) throw new Error('查询结果格式异常，请稍后重试。');
    if (error instanceof TypeError) throw new Error('网络连接失败，请检查网络后重试。');
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function fetchAggregatedRankings(_config: ApiHeaderConfig, search: SearchConfig, onProgress: (msg: string, progress: number) => void) {
  return queryApi<PlayerRank>('/api/rankings', { ...search }, onProgress);
}

export function fetchPlayerMatches(_config: ApiHeaderConfig, playerName: string, search: SearchConfig, onProgress: (msg: string, progress: number) => void) {
  return queryApi<MatchScoreResult>('/api/matches', {
    playerName: playerName.trim(), playerGender: search.playerGender,
    gameKeywords: search.gameKeywords, province: search.province, city: search.city,
  }, onProgress);
}
