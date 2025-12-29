import { ApiHeaderConfig, SearchConfig, GameBasicInfo, MatchItem, PlayerRank, MatchScoreResult } from '../types';

const CORS_PROXY_WARNING = "注意：从本地 Web 应用请求 ymq.me 通常需要开启 CORS 代理或浏览器插件（如 'Allow CORS'）。";

// --- GLOBAL MEMORY CACHE (Session Level) ---
const MEMORY_CACHE: {
    rankings: { data: PlayerRank[], timestamp: number } | null;
    matches: { data: MatchScoreResult[], timestamp: number } | null;
} = {
    rankings: null,
    matches: null
};

// Cache Time-To-Live in Memory (e.g., 30 minutes)
const MEMORY_CACHE_TTL = 30 * 60 * 1000; 

const getHeaders = (config: ApiHeaderConfig, referer = 'https://sports.ymq.me/') => {
  return {
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'Origin': 'https://sports.ymq.me',
    'Referer': referer,
    'mode': 'cors',
  };
};

// --- Helper: String Normalization ---
const normalize = (str: string | undefined | null) => (str || '').trim().toUpperCase();

// --- Helper: Filter Logic Engine ---
// Returns TRUE if the item matches ALL active filters
const isRankMatch = (item: any, config: SearchConfig): boolean => {
    const fullText = normalize(
        (item.fullGroupName || '') + ' ' + 
        (item.groupName || '') + ' ' + 
        (item.itemType || '') + ' ' + 
        (item.name || item.itemName || '')
    );

    // 1. Gender Filter (Strict Keyword Match)
    if (config.playerGender) {
        if (config.playerGender === 'M' && !fullText.includes('男')) return false;
        if (config.playerGender === 'F' && !fullText.includes('女')) return false;
    }

    // --- REFACTORED GROUP FILTERING (U-Series OR Level) ---
    // User Requirement: "U8" + "Children" should match BOTH "U8 Group" AND "Children Group".
    // Logic: If both U-Keywords and Level-Keywords are present, we treat them as alternatives (OR).
    
    const uKeys = normalize(config.uKeywords).split(/[,，]/).filter(k => k);
    const levelKeys = normalize(config.levelKeywords).split(/[,，]/).filter(k => k);
    
    const hasU = uKeys.length > 0;
    const hasLevel = levelKeys.length > 0;

    // 2. U-Series Check (OR Logic internal: U8 or U9)
    const uMatch = hasU ? uKeys.some(k => fullText.includes(k)) : false;

    // 3. Level Check (AND Logic internal: Primary AND Group A)
    const levelMatch = hasLevel ? levelKeys.every(k => fullText.includes(k)) : false;

    // Combined Logic:
    // If BOTH filters exist, accept matches from EITHER side.
    // If only ONE exists, enforce that one.
    if (hasU && hasLevel) {
        if (!uMatch && !levelMatch) return false;
    } else if (hasU) {
        if (!uMatch) return false;
    } else if (hasLevel) {
        if (!levelMatch) return false;
    }

    // 4. Item Type (OR Logic): e.g., "男单,男双"
    const itemKeys = normalize(config.itemKeywords).split(/[,，]/).filter(k => k);
    if (itemKeys.length > 0) {
        const hasMatch = itemKeys.some(k => fullText.includes(k));
        if (!hasMatch) return false;
    }

    // 5. Game Keywords (Regex)
    const gameKeys = normalize(config.gameKeywords).split(/[,，]/).filter(k => k);
    if (gameKeys.length > 0) {
        const gameName = normalize(item.game_name);
        const hasMatch = gameKeys.some(k => gameName.includes(k));
        if (!hasMatch) return false;
    }

    // 6. Player Name (Partial)
    if (config.targetPlayerName) {
        const target = normalize(config.targetPlayerName);
        const pName = normalize(item.playerName);
        if (!pName.includes(target)) return false;
    }

    return true;
};

const isMatchRecordMatch = (match: any, config: SearchConfig, strictPlayerName?: string): boolean => {
    // 1. Target Player Name Check (Strict for specific player search)
    if (strictPlayerName) {
        const target = normalize(strictPlayerName);
        const pA = normalize(match.playerA || match.mateOne || match.user1Name);
        const pB = normalize(match.playerB || match.mateTwo || match.user2Name);
        
        // Must involve the player
        if (!pA.includes(target) && !pB.includes(target)) return false;
    }

    // 2. Game Keywords
    const gameKeys = normalize(config.gameKeywords).split(/[,，]/).filter(k => k);
    if (gameKeys.length > 0) {
        const gameName = normalize(match.game_name);
        const hasMatch = gameKeys.some(k => gameName.includes(k));
        if (!hasMatch) return false;
    }

    // 3. Gender Filter (Strict Keyword Match on fullName)
    if (config.playerGender) {
        // match.fullName comes from daily_matches.json (ensure we check it)
        const fullText = normalize(
            (match.fullName || '') + ' ' + 
            (match.groupName || '') + ' ' + 
            (match.itemType || '')
        );
        
        if (config.playerGender === 'M' && !fullText.includes('男')) return false;
        if (config.playerGender === 'F' && !fullText.includes('女')) return false;
    }

    return true;
};

// --- Helper: Process and Cache JSON ---
function processJson<T>(json: any, type: 'rankings' | 'matches', onProgress: (msg: string, progress: number) => void): T[] {
     if (json && Array.isArray(json.data) && json.data.length > 0) {
         MEMORY_CACHE[type] = { data: json.data, timestamp: Date.now() };
         onProgress("✅ 数据文件加载成功，正在解析...", 25);
         return json.data;
     } else {
         const status = json?.status === 'initializing' ? '初始化中' : '无数据';
         onProgress(`⚠️ 服务端数据状态: ${status}`, 25);
         return [];
     }
}

// --- Helper: Load Static Data with Download Progress ---
async function loadStaticData<T>(
    type: 'rankings' | 'matches',
    onProgress: (msg: string, progress: number) => void
): Promise<T[]> {
    if (MEMORY_CACHE[type] && (Date.now() - MEMORY_CACHE[type]!.timestamp < MEMORY_CACHE_TTL)) {
        onProgress("🧠 读取浏览器内存缓存...", 10);
        return MEMORY_CACHE[type]!.data as T[];
    }
    
    const filename = type === 'rankings' ? 'daily_rankings.json' : 'daily_matches.json';
    onProgress(`📡 正在同步服务端数据 /${filename}...`, 5);
    
    try {
        const hourTs = Math.floor(Date.now() / (1000 * 60 * 60)); 
        const res = await fetch(`/${filename}?t=${hourTs}`);
        
        if (!res.ok) {
             onProgress(`⚠️ 未找到服务端数据文件 (HTTP ${res.status})`, 100);
             return [];
        }

        const contentLength = res.headers.get('content-length');
        const total = contentLength ? parseInt(contentLength, 10) : 0;
        let loaded = 0;

        const reader = res.body?.getReader();
        if (!reader) {
             const json = await res.json();
             return processJson(json, type, onProgress);
        }

        const chunks: Uint8Array[] = [];
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
                chunks.push(value);
                loaded += value.length;
                if (total > 0) {
                    const dlPercent = Math.floor((loaded / total) * 100);
                    const stepProgress = 5 + Math.floor((loaded / total) * 45); // Map to 5-50%
                    const loadedMB = (loaded / (1024 * 1024)).toFixed(2);
                    const totalMB = (total / (1024 * 1024)).toFixed(2);
                    onProgress(`⬇️ 下载中: ${loadedMB}MB / ${totalMB}MB (${dlPercent}%)`, stepProgress);
                } else {
                    const loadedMB = (loaded / (1024 * 1024)).toFixed(2);
                    onProgress(`⬇️ 下载中: ${loadedMB}MB...`, 10);
                }
            }
        }

        onProgress("📦 下载完成，正在构建索引...", 60);

        const allChunks = new Uint8Array(loaded);
        let position = 0;
        for (const chunk of chunks) {
            allChunks.set(chunk, position);
            position += chunk.length;
        }

        const text = new TextDecoder("utf-8").decode(allChunks);
        const json = JSON.parse(text);

        return processJson(json, type, onProgress);

    } catch (e) {
        console.warn("Static load failed", e);
        onProgress("⚠️ 数据加载失败，请检查网络", 100);
    }
    return [];
}

// 1. Fetch Rankings (Aggregated) - STATIC ONLY
export const fetchAggregatedRankings = async (
  config: ApiHeaderConfig, 
  searchConfig: SearchConfig,
  onProgress: (msg: string, progress: number) => void
): Promise<{source: 'CACHE' | 'LIVE', data: PlayerRank[], updatedAt?: string}> => {
  
  // --- TIER 1: LOAD STATIC DATA ---
  const sourceData = await loadStaticData<PlayerRank>('rankings', onProgress);

  // --- TIER 2: FILTER ---
  if (sourceData.length > 0) {
      onProgress(`🔍 正在本地筛选数据...`, 80);
      
      const filtered = sourceData.filter((rank) => isRankMatch(rank, searchConfig));

      onProgress(`🎉 筛选完成！找到 ${filtered.length} 条数据`, 100);
      return { source: 'CACHE', data: filtered, updatedAt: '刚刚 (静态库)' };
  }

  // No Fallback to Live
  onProgress("📭 本地数据中未找到匹配项。", 100);
  return { source: 'CACHE', data: [] };
};

// 2. Fetch Matches - STATIC ONLY
export const fetchPlayerMatches = async (
  config: ApiHeaderConfig,
  playerName: string,
  searchConfig: SearchConfig, 
  onProgress: (msg: string, progress: number) => void
): Promise<MatchScoreResult[]> => {
  
  const targetName = playerName.trim();
  
  // --- TIER 1: LOAD STATIC DATA ---
  const sourceData = await loadStaticData<MatchScoreResult>('matches', onProgress);

  // --- TIER 2: FILTER ---
  if (sourceData.length > 0) {
      onProgress(`🔍 正在检索 "${playerName}" 的记录...`, 80);
      
      const hits = sourceData.filter((m) => isMatchRecordMatch(m, searchConfig, targetName));
      
      onProgress(`🎉 检索完成！找到 ${hits.length} 场记录`, 100);
      return hits;
  }

  // No Fallback to Live
  onProgress("📭 数据库中未找到该选手的比赛记录。", 100);
  return [];
};

// Deprecated but kept to prevent import errors if App.tsx imports it directly (though strictly speaking we could remove it if unused)
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