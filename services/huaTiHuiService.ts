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
        (item.groupName || '') + ' ' + 
        (item.itemType || '') + ' ' + 
        (item.name || item.itemName || '')
    );

    // 1. Gender Filter (Strict Keyword Match)
    if (config.playerGender) {
        if (config.playerGender === 'M' && !fullText.includes('男')) return false;
        if (config.playerGender === 'F' && !fullText.includes('女')) return false;
    }

    // 2. U-Series (OR Logic): e.g., "U8,U9" -> Match if ANY exists
    const uKeys = normalize(config.uKeywords).split(/[,，]/).filter(k => k);
    if (uKeys.length > 0) {
        const hasMatch = uKeys.some(k => fullText.includes(k));
        if (!hasMatch) return false;
    }

    // 3. Level/School (AND Logic): e.g., "小学,乙" -> Match if ALL exist
    const levelKeys = normalize(config.levelKeywords).split(/[,，]/).filter(k => k);
    if (levelKeys.length > 0) {
        const allMatch = levelKeys.every(k => fullText.includes(k));
        if (!allMatch) return false;
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

// --- Helper: Concurrency Limit Executor ---
async function runInBatches<T, R>(items: T[], batchSize: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  let results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchPromises = batch.map((item, batchIdx) => fn(item, i + batchIdx));
    const batchResults = await Promise.all(batchPromises);
    results = results.concat(batchResults);
  }
  return results;
}

// --- Helper: Process and Cache JSON ---
function processJson<T>(json: any, type: 'rankings' | 'matches', onProgress: (msg: string, progress: number) => void): T[] {
     if (json && Array.isArray(json.data) && json.data.length > 0) {
         MEMORY_CACHE[type] = { data: json.data, timestamp: Date.now() };
         onProgress("✅ 数据解析成功，已缓存至内存。", 25);
         return json.data;
     } else {
         const status = json?.status === 'initializing' ? '初始化中' : '无数据';
         onProgress(`⚠️ 服务端文件状态: ${status}，准备切换至实时搜索...`, 25);
         return [];
     }
}

// --- Helper: Load Static Data with Download Progress ---
async function loadStaticData<T>(
    type: 'rankings' | 'matches',
    onProgress: (msg: string, progress: number) => void
): Promise<T[]> {
    if (MEMORY_CACHE[type] && (Date.now() - MEMORY_CACHE[type]!.timestamp < MEMORY_CACHE_TTL)) {
        onProgress("🧠 读取本地缓存数据...", 10);
        return MEMORY_CACHE[type]!.data as T[];
    }
    
    const filename = type === 'rankings' ? 'daily_rankings.json' : 'daily_matches.json';
    onProgress(`📡 准备下载服务端数据文件 /${filename}...`, 5);
    
    try {
        const hourTs = Math.floor(Date.now() / (1000 * 60 * 60)); 
        const res = await fetch(`/${filename}?t=${hourTs}`);
        
        if (!res.ok) {
             onProgress(`⚠️ 未找到服务端文件 (HTTP ${res.status})，准备切换至实时搜索...`, 15);
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
                    const stepProgress = 5 + Math.floor((loaded / total) * 15); 
                    const loadedMB = (loaded / (1024 * 1024)).toFixed(2);
                    const totalMB = (total / (1024 * 1024)).toFixed(2);
                    onProgress(`⬇️ 下载中: ${loadedMB}MB / ${totalMB}MB (${dlPercent}%)`, stepProgress);
                } else {
                    const loadedMB = (loaded / (1024 * 1024)).toFixed(2);
                    onProgress(`⬇️ 下载中: ${loadedMB}MB...`, 10);
                }
            }
        }

        onProgress("📦 下载完成，正在解析 JSON...", 22);

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
        onProgress("⚠️ 数据文件加载失败，准备切换至实时搜索...", 15);
    }
    return [];
}

// 1. Get Game Full List (with Province/City Filter)
export const fetchGameList = async (config: ApiHeaderConfig, searchConfig: SearchConfig): Promise<GameBasicInfo[]> => {
  const effectiveSnTime = Date.now();
  const url = `https://applyv3.ymq.me/public/public/getgamefulllist?t=${effectiveSnTime}`;
  
  // Normalize Province/City logic
  let rawProvince = (searchConfig.province || '').trim();
  let rawCity = (searchConfig.city || '').trim();
  const municipalities = ['北京', '上海', '天津', '重庆'];
  const provMuniMatch = municipalities.find(m => rawProvince.startsWith(m));
  const cityMuniMatch = municipalities.find(m => rawCity.startsWith(m));

  let finalProvince = "";
  let finalCity = "";

  if (provMuniMatch) {
    finalProvince = provMuniMatch + "市";
  } else if (cityMuniMatch) {
    finalProvince = cityMuniMatch + "市";
  } else {
    if (rawProvince) {
      finalProvince = rawProvince.endsWith('省') || rawProvince.endsWith('市') ? rawProvince : rawProvince + '省';
    }
    if (rawCity) {
      finalCity = (!rawCity.endsWith('市') && !rawCity.endsWith('区') && !rawCity.endsWith('盟') && !rawCity.endsWith('州')) ? rawCity + '市' : rawCity;
    }
  }

  const requestBody: any = {
    page_num: 1,
    page_size: 100, 
    statuss: [10], 
    province: finalProvince ? [finalProvince] : [],
  };
  if (finalCity) requestBody.city = [finalCity];

  const payload = {
    body: requestBody,
    header: { token: config.token, snTime: effectiveSnTime, sn: config.sn, from: "web" }
  };

  try {
    const response = await fetch(url, { method: 'POST', headers: getHeaders(config), body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(`API Error: ${response.status}`);
    const data = await response.json();
    
    // Filter by Game Keywords immediately
    const gameKeys = normalize(searchConfig.gameKeywords).split(/[,，]/).filter(k => k);
    
    if (data && data.data && Array.isArray(data.data.list)) {
      return data.data.list
        .filter((game: any) => {
            if (gameKeys.length === 0) return true;
            return gameKeys.some((k: string) => normalize(game.game_name).includes(k));
        })
        .map((game: any) => ({
          id: game.id,
          game_name: game.game_name,
          start_date: game.start_date || (game.end_game_time ? new Date(game.end_game_time * 1000).toLocaleDateString() : '未知日期')
        }));
    }
    return [];
  } catch (error) {
    console.error("Fetch Game List Error", error);
    throw new Error(`获取赛事列表失败。${CORS_PROXY_WARNING}`);
  }
};

// 2. Fetch Rankings (Aggregated)
export const fetchAggregatedRankings = async (
  config: ApiHeaderConfig, 
  searchConfig: SearchConfig,
  onProgress: (msg: string, progress: number) => void
): Promise<{source: 'CACHE' | 'LIVE', data: PlayerRank[], updatedAt?: string}> => {
  
  // --- TIER 1: LOAD CACHED DATA ---
  const sourceData = await loadStaticData<PlayerRank>('rankings', onProgress);

  // --- TIER 2: FILTER CACHED DATA ---
  if (sourceData.length > 0) {
      onProgress(`🔍 正在本地筛选...`, 25);
      
      const filtered = sourceData.filter((rank) => isRankMatch(rank, searchConfig));

      if (filtered.length > 0) {
          onProgress(`🎉 本地命中！找到 ${filtered.length} 条数据`, 100);
          return { source: 'CACHE', data: filtered, updatedAt: '刚刚 (静态库)' };
      }
      onProgress(`⚠️ 本地数据未匹配到结果，准备启动网络搜索...`, 28);
  }

  // --- TIER 3: LIVE API FALLBACK ---
  onProgress("🚀 启动网络搜索引擎...", 30);
  const games = await fetchGameList(config, searchConfig);

  if (games.length === 0) {
      return { source: 'LIVE', data: [] };
  }

  onProgress(`✅ 锁定 ${games.length} 个相关赛事，开始检索...`, 35);
  
  let processedCount = 0;
  
  const results = await runInBatches(games, 5, async (game, index) => {
    const ranksInGame: PlayerRank[] = [];
    try {
      if (index % 2 === 0) {
        processedCount = index + 1;
        onProgress(`[网络搜索] 正在检索: ${game.game_name} (${processedCount}/${games.length})`, Math.floor((processedCount / games.length) * 50) + 35);
      }
      const effectiveSnTime = Date.now();
      const fetchBody = {
          body: { raceId: game.id },
          header: { token: config.token, snTime: effectiveSnTime, sn: config.sn, from: "wx" }
      };
      const fetchOptions = {
          method: 'POST',
          headers: getHeaders(config, 'https://apply.ymq.me/'),
          body: JSON.stringify(fetchBody)
      };

      // 1. Fetch Groups/Items
      const [itemsRes, groupsRes] = await Promise.all([
         fetch('https://race.ymq.me/webservice/appWxRace/allItems.do', fetchOptions).catch(() => ({ json: () => ({ detail: [] }) })),
         fetch('https://race.ymq.me/webservice/appWxRace/allGroups.do', fetchOptions).catch(() => ({ json: () => ({ detail: [] }) }))
      ]);

      // @ts-ignore
      const itemsData = await itemsRes.json();
      // @ts-ignore
      const groupsData = await groupsRes.json();

      const itemsList = itemsData?.detail || [];
      const groupsList = groupsData?.detail || [];
      
      const allTargets = [
          ...itemsList.map((i: any) => ({ ...i, _isGroup: false })),
          ...groupsList.map((g: any) => ({ ...g, _isGroup: true }))
      ];

      // 2. Pre-Filter Items (Client side optimization to save API calls)
      // We reconstruct a mock "Rank" object to test against isRankMatch filter
      const relevantItems = allTargets.filter((item: any) => {
          const mockRank = {
              groupName: item.groupName,
              itemType: item.itemType,
              name: item.itemName, // API field varies
              itemName: item.itemName,
              game_name: game.game_name,
              // We don't have playerName yet, so we pass empty to skip that check momentarily
              // OR we skip the player name check here and do it after fetching
              playerName: '' 
          };
          
          // Use a config without player name for pre-filtering groups
          const configForGroup = { ...searchConfig, targetPlayerName: '' };
          return isRankMatch(mockRank, configForGroup);
      });

      // 3. Get Ranks for Relevant Items/Groups
      await Promise.all(relevantItems.map(async (item: any) => {
        try {
          const isGroup = item._isGroup;
          const groupId = isGroup ? item.id : null;
          const itemId = isGroup ? null : item.id;

          const rankRes = await fetch('https://race.ymq.me/webservice/appWxRank/showRankScore.do', {
            method: 'POST',
            headers: getHeaders(config, 'https://apply.ymq.me/'),
            body: JSON.stringify({
              body: { raceId: game.id, groupId: groupId, itemId: itemId },
              header: { token: config.token, snTime: Date.now(), sn: config.sn, from: "wx" }
            })
          });
          const rankData = await rankRes.json();
          if (rankData?.detail) {
            rankData.detail.forEach((r: any) => {
              const rankObj: PlayerRank = {
                raceId: game.id,
                game_name: game.game_name,
                groupName: item.groupName || '未知组别',
                playerName: r.playerName,
                rank: r.rank,
                score: r.score,
                club: r.club || r.teamName
              };
              
              // Final check (including Player Name which we skipped in pre-filter)
              if (isRankMatch(rankObj, searchConfig)) {
                  ranksInGame.push(rankObj);
              }
            });
          }
        } catch (innerE) {}
      }));
    } catch (e) {
      console.warn(`Error scanning game ${game.id}`, e);
    }
    return ranksInGame;
  });
  
  return { source: 'LIVE', data: results.flat() };
};

// 3. Fetch Matches
export const fetchPlayerMatches = async (
  config: ApiHeaderConfig,
  playerName: string,
  searchConfig: SearchConfig, 
  onProgress: (msg: string, progress: number) => void
): Promise<MatchScoreResult[]> => {
  
  const targetName = playerName.trim();
  
  // --- TIER 1: LOAD CACHED DATA ---
  const sourceData = await loadStaticData<MatchScoreResult>('matches', onProgress);

  // --- TIER 2: FILTER CACHED DATA ---
  if (sourceData.length > 0) {
      onProgress(`🔍 正在本地比分库中检索 "${playerName}"...`, 25);
      
      const hits = sourceData.filter((m) => isMatchRecordMatch(m, searchConfig, targetName));
      
      if (hits.length > 0) {
          onProgress(`🎉 本地命中！找到 ${hits.length} 场记录`, 100);
          return hits;
      }
      onProgress(`⚠️ 本地比分库未找到符合条件的记录，准备启动网络搜索...`, 28);
  }

  // --- TIER 3: LIVE API FALLBACK ---
  onProgress("🚀 启动网络搜索引擎...", 30);
  const games = await fetchGameList(config, searchConfig);

  if (games.length === 0) return [];
  onProgress(`✅ 锁定 ${games.length} 个相关赛事，开始检索...`, 35);

  let processedCount = 0;

  const results = await runInBatches(games, 8, async (game, index) => {
    const matchesInGame: MatchScoreResult[] = [];
    
    if (index % 3 === 0) {
       processedCount = index;
       const percent = Math.floor((processedCount / games.length) * 50) + 35;
       onProgress(`[网络搜索] 正在检索: ${game.game_name}`, percent);
    }

    const effectiveSnTime = Date.now();
    try {
      const res = await fetch(`https://race.ymq.me/webservice/appWxMatch/matchesScore.do?t=${effectiveSnTime}`, {
        method: 'POST',
        headers: getHeaders(config, 'https://apply.ymq.me/'),
        body: JSON.stringify({
          body: {
            raceId: game.id,
            page: 1,
            rows: 50, 
            keyword: targetName // Use backend search directly
          },
          header: { token: config.token, snTime: effectiveSnTime, sn: config.sn, from: "wx" }
        })
      });

      if (!res.ok) return [];
      const data = await res.json();
      const rows = data?.detail?.rows || data?.list || [];

      if (Array.isArray(rows)) {
        rows.forEach((m: any) => {
          let p1 = m.mateOne;
          if (!p1 && Array.isArray(m.playerOnes) && m.playerOnes.length > 0) p1 = m.playerOnes[0].name;
          if (!p1) p1 = m.user1Name || m.playerA || '未知选手A';

          let p2 = m.mateTwo;
          if (!p2 && Array.isArray(m.playerTwos) && m.playerTwos.length > 0) p2 = m.playerTwos[0].name;
          if (!p2) p2 = m.user2Name || m.playerB || '未知选手B';

          let finalScore = "0:0";
          let statusLabel = "";

          if (typeof m.scoreOne === 'number' && typeof m.scoreTwo === 'number') {
             finalScore = `${m.scoreOne}:${m.scoreTwo}`;
          } else if (m.score && typeof m.score === 'string' && m.score.includes(':') && m.score !== '0:0') {
            finalScore = m.score;
          } else if (m.score1 !== undefined && m.score2 !== undefined && m.score1 !== null) {
            finalScore = `${m.score1}:${m.score2}`;
          } else if (m.user1Score !== undefined && m.user2Score !== undefined) {
             finalScore = `${m.user1Score}:${m.user2Score}`;
          }

          if (finalScore === "0:0") {
             if (m.status === 0 || (m.status === undefined && !m.winnerId && m.scoreStatusNo !== 2)) {
                statusLabel = " (未开始)";
             }
          }

          const matchObj: MatchScoreResult = {
            raceId: game.id,
            game_name: game.game_name,
            matchId: m.id,
            groupName: m.fullName || m.groupName || '未知组别',
            itemType: m.itemType || m.itemName,
            playerA: p1,
            playerB: p2,
            score: finalScore + statusLabel,
            matchTime: m.raceTimeName || m.matchTime,
            round: m.roundName || m.rulesName || m.round || '-'
          };

          // Apply Client-Side Filter on API Results
          // (Backend handles Name matching partially via 'keyword', but we double check strictness and gender)
          if (isMatchRecordMatch(matchObj, searchConfig, targetName)) {
              matchesInGame.push(matchObj);
          }
        });
      }
    } catch (e) {
      console.warn(`Error fetching matches for ${game.id}`, e);
    }
    return matchesInGame;
  });

  return results.flat();
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