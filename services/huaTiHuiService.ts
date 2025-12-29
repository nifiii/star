import { ApiHeaderConfig, SearchConfig, GameBasicInfo, MatchItem, PlayerRank, MatchScoreResult } from '../types';

const CORS_PROXY_WARNING = "注意：从本地 Web 应用请求 ymq.me 通常需要开启 CORS 代理或浏览器插件（如 'Allow CORS'）。";

// --- GLOBAL MEMORY CACHE (Session Level) ---
// Now acts as a cache for API responses to avoid re-fetching same queries
const QUERY_CACHE: Map<string, { data: any[], timestamp: number }> = new Map();

// Cache Time-To-Live in Memory (e.g., 5 minutes for API responses)
const MEMORY_CACHE_TTL = 5 * 60 * 1000; 

const getHeaders = (config: ApiHeaderConfig, referer = 'https://sports.ymq.me/') => {
  return {
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'Origin': 'https://sports.ymq.me',
    'Referer': referer,
    'mode': 'cors',
  };
};

// --- API Helper ---
async function queryApi<T>(
    endpoint: string, 
    params: Record<string, any>, 
    onProgress: (msg: string, progress: number) => void
): Promise<T[]> {
    const url = new URL(endpoint, window.location.origin);
    
    // Append Params
    Object.keys(params).forEach(key => {
        if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
            url.searchParams.append(key, String(params[key]));
        }
    });

    const cacheKey = url.toString();
    
    // Check Cache
    if (QUERY_CACHE.has(cacheKey)) {
        const cached = QUERY_CACHE.get(cacheKey)!;
        if (Date.now() - cached.timestamp < MEMORY_CACHE_TTL) {
            onProgress("🧠 命中API缓存...", 50);
            return cached.data as T[];
        }
    }

    onProgress(`📡 正在请求服务端接口...`, 10);
    
    try {
        const res = await fetch(url.toString());
        if (!res.ok) {
            throw new Error(`API Error: ${res.status}`);
        }
        
        onProgress("⬇️ 正在接收数据...", 60);
        const json = await res.json();
        
        onProgress("✅ 数据接收完成", 100);
        
        const data = json.data || [];
        
        // Update Cache
        QUERY_CACHE.set(cacheKey, { data, timestamp: Date.now() });
        
        return data;

    } catch (e: any) {
        console.warn("API Query Failed", e);
        // Fallback or re-throw
        throw e;
    }
}


// 1. Fetch Rankings (via API)
export const fetchAggregatedRankings = async (
  config: ApiHeaderConfig, 
  searchConfig: SearchConfig,
  onProgress: (msg: string, progress: number) => void
): Promise<{source: 'CACHE' | 'LIVE' | 'API', data: PlayerRank[], updatedAt?: string}> => {
  
  try {
      // Map SearchConfig to API Params
      const params = {
          uKeywords: searchConfig.uKeywords,
          levelKeywords: searchConfig.levelKeywords,
          itemKeywords: searchConfig.itemKeywords,
          gameKeywords: searchConfig.gameKeywords,
          targetPlayerName: searchConfig.targetPlayerName,
          playerGender: searchConfig.playerGender,
          province: searchConfig.province, // [Added]
          city: searchConfig.city          // [Added]
      };

      const data = await queryApi<PlayerRank>('/api/rankings', params, onProgress);
      
      return { 
          source: 'API', 
          data: data, 
          updatedAt: '刚刚 (服务端API)' 
      };

  } catch (e) {
      onProgress("❌ 服务端查询失败，请检查网络", 100);
      return { source: 'API', data: [] };
  }
};

// 2. Fetch Matches (via API)
export const fetchPlayerMatches = async (
  config: ApiHeaderConfig,
  playerName: string,
  searchConfig: SearchConfig, 
  onProgress: (msg: string, progress: number) => void
): Promise<MatchScoreResult[]> => {
  
  const targetName = playerName.trim();
  
  try {
      const params = {
          playerName: targetName,
          playerGender: searchConfig.playerGender,
          gameKeywords: searchConfig.gameKeywords,
          province: searchConfig.province, // [Added]
          city: searchConfig.city          // [Added]
      };

      const data = await queryApi<MatchScoreResult>('/api/matches', params, onProgress);
      return data;

  } catch (e) {
      onProgress("❌ 服务端查询失败", 100);
      return [];
  }
};

// Deprecated
export const fetchGameList = async (config: ApiHeaderConfig, searchConfig: SearchConfig): Promise<GameBasicInfo[]> => {
    return [];
};

export const getMockRanks = (): PlayerRank[] => {
  return Array.from({ length: 15 }).map((_, i) => ({
    raceId: `mock-${i}`,
    game_name: `2025 广州青少年羽毛球公开赛 第${i+1}站`,
    groupName: 'U8 男单 A组',
    playerName: i % 2 === 0 ? "张三" : "李四",
    rank: i + 1,
    score: 100 - i * 5,
    club: "飞羽俱乐部"
  }));
};

export const getMockMatches = (playerName: string): MatchScoreResult[] => {
  return Array.from({ length: 5 }).map((_, i) => ({
    raceId: `mock-${i}`,
    game_name: `2025 广州青少年羽毛球公开赛 第${i+1}站`,
    groupName: 'U8 男单 A组',
    playerA: playerName,
    playerB: "对手" + i,
    score: i % 2 === 0 ? "21:15" : "18:21",
    round: "1/4决赛"
  }));
};