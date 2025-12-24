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
    // 1. Check Memory Cache
    if (MEMORY_CACHE[type] && (Date.now() - MEMORY_CACHE[type]!.timestamp < MEMORY_CACHE_TTL)) {
        onProgress("🧠 读取本地缓存数据...", 10);
        return MEMORY_CACHE[type]!.data as T[];
    }
    
    // 2. Download from Server
    const filename = type === 'rankings' ? 'daily_rankings.json' : 'daily_matches.json';
    onProgress(`📡 准备下载服务端数据文件 /${filename}...`, 5);
    
    try {
        const hourTs = Math.floor(Date.now() / (1000 * 60 * 60)); // Cache bust every hour
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
             // Fallback if streams not supported
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
                    // Map 0-100% download to 5-20% overall progress
                    const stepProgress = 5 + Math.floor((loaded / total) * 15); 
                    
                    const loadedMB = (loaded / (1024 * 1024)).toFixed(2);
                    const totalMB = (total / (1024 * 1024)).toFixed(2);
                    
                    onProgress(`⬇️ 下载中: ${loadedMB}MB / ${totalMB}MB (${dlPercent}%)`, stepProgress);
                } else {
                    // Unknown length
                    const loadedMB = (loaded / (1024 * 1024)).toFixed(2);
                    onProgress(`⬇️ 下载中: ${loadedMB}MB...`, 10);
                }
            }
        }

        onProgress("📦 下载完成，正在解析 JSON...", 22);

        // Combine chunks
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

// 1. Get Game Full List
export const fetchGameList = async (config: ApiHeaderConfig, searchConfig: SearchConfig): Promise<GameBasicInfo[]> => {
  const effectiveSnTime = Date.now();
  const url = `https://applyv3.ymq.me/public/public/getgamefulllist?t=${effectiveSnTime}`;
  
  // Normalize Province/City
  let rawProvince = searchConfig.province.trim();
  let rawCity = searchConfig.city.trim();
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
    
    const keywords = searchConfig.gameKeywords.split(',').map(k => k.trim()).filter(k => k);
    const nameRegex = keywords.length > 0 ? new RegExp(keywords.join('|'), 'i') : null;

    if (data && data.data && Array.isArray(data.data.list)) {
      return data.data.list
        .filter((game: any) => nameRegex ? nameRegex.test(game.game_name) : true)
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
      
      const uKeys = searchConfig.uKeywords.split(',').map(k => k.trim().toUpperCase()).filter(k => k);
      const levelKeys = searchConfig.levelKeywords.split(',').map(k => k.trim().toUpperCase()).filter(k => k);
      const typeKeys = searchConfig.itemKeywords.split(',').map(k => k.trim()).filter(k => k);
      const gameKeywords = searchConfig.gameKeywords.split(',').map(k => k.trim()).filter(k => k);
      const nameRegex = gameKeywords.length > 0 ? new RegExp(gameKeywords.join('|'), 'i') : null;
      const targetName = (searchConfig.targetPlayerName || '').trim();

      const filtered = sourceData.filter((rank: PlayerRank) => {
           if (nameRegex && !nameRegex.test(rank.game_name)) return false;
           if (targetName && !rank.playerName.includes(targetName)) return false;

           const gName = (rank.groupName || '').toUpperCase();
           
           // Group Filtering Logic
           const hasU = uKeys.length > 0;
           const hasLevel = levelKeys.length > 0;
           let groupMatched = true;

           if (hasU || hasLevel) {
              const matchesU = hasU && uKeys.some(k => gName.includes(k));
              const matchesLevel = hasLevel && levelKeys.every(k => gName.includes(k));
              if (hasU && !hasLevel) groupMatched = matchesU;
              else if (!hasU && hasLevel) groupMatched = matchesLevel;
              else groupMatched = matchesU || matchesLevel;
           }

           if (!groupMatched) return false;

           if (typeKeys.length > 0) {
               const rAny = rank as any;
               const fullText = ((rAny.groupName || '') + ' ' + (rAny.game_name || '') + ' ' + (rAny.itemType || '') + ' ' + (rAny.itemName || '')).toUpperCase();
               if (!typeKeys.some(k => fullText.includes(k.toUpperCase()))) return false;
           }
           return true;
      });

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

  const uKeys = searchConfig.uKeywords.split(',').map(k => k.trim().toUpperCase()).filter(k => k);
  const levelKeys = searchConfig.levelKeywords.split(',').map(k => k.trim().toUpperCase()).filter(k => k);
  const typeKeys = searchConfig.itemKeywords.split(',').map(k => k.trim()).filter(k => k);
  
  let processedCount = 0;
  
  const results = await runInBatches(games, 5, async (game, index) => {
    const ranksInGame: PlayerRank[] = [];
    try {
      if (index % 2 === 0) {
        processedCount = index + 1;
        onProgress(`[网络搜索] 正在检索: ${game.game_name} (${processedCount}/${games.length})`, Math.floor((processedCount / games.length) * 50) + 35);
      }
      const effectiveSnTime = Date.now();
      
      // 1. Get Items
      const itemsRes = await fetch('https://race.ymq.me/webservice/appWxRace/allItems.do', {
        method: 'POST',
        headers: getHeaders(config, 'https://apply.ymq.me/'),
        body: JSON.stringify({
          body: { raceId: game.id },
          header: { token: config.token, snTime: effectiveSnTime, sn: config.sn, from: "wx" }
        })
      });
      const itemsData = await itemsRes.json();
      
      if (!itemsData?.detail) return [];

      // 2. Filter Items (Client side optimization to reduce requests)
      const relevantItems = itemsData.detail.filter((item: any) => {
        const gName = (item.groupName || '').toUpperCase();
        const iType = (item.itemType || item.itemName || '').toUpperCase(); 
        
        const hasU = uKeys.length > 0;
        const hasLevel = levelKeys.length > 0;
        let groupMatched = true;

        if (hasU || hasLevel) {
           const matchesU = hasU && uKeys.some(k => gName.includes(k));
           const matchesLevel = hasLevel && levelKeys.every(k => gName.includes(k));
           if (hasU && !hasLevel) groupMatched = matchesU;
           else if (!hasU && hasLevel) groupMatched = matchesLevel;
           else groupMatched = matchesU || matchesLevel;
        }

        if (!groupMatched) return false;
        return typeKeys.length === 0 || typeKeys.some(k => iType.includes(k) || gName.includes(k));
      });

      // 3. Get Ranks for Items
      await Promise.all(relevantItems.map(async (item: any) => {
        try {
          const rankRes = await fetch('https://race.ymq.me/webservice/appWxRank/showRankScore.do', {
            method: 'POST',
            headers: getHeaders(config, 'https://apply.ymq.me/'),
            body: JSON.stringify({
              body: { raceId: game.id, groupId: null, itemId: item.id },
              header: { token: config.token, snTime: Date.now(), sn: config.sn, from: "wx" }
            })
          });
          const rankData = await rankRes.json();
          if (rankData?.detail) {
            rankData.detail.forEach((r: any) => {
              const targetName = (searchConfig.targetPlayerName || '').trim();
              if (targetName && !r.playerName.includes(targetName)) return;

              ranksInGame.push({
                raceId: game.id,
                game_name: game.game_name,
                groupName: item.groupName,
                playerName: r.playerName,
                rank: r.rank,
                score: r.score,
                club: r.club || r.teamName
              });
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
  
  const targetName = playerName.trim().toLowerCase();
  
  // --- TIER 1: LOAD CACHED DATA ---
  const sourceData = await loadStaticData<MatchScoreResult>('matches', onProgress);

  // --- TIER 2: FILTER CACHED DATA ---
  if (sourceData.length > 0) {
      onProgress(`🔍 正在本地比分库中检索 "${playerName}"...`, 25);
      
      const hits = sourceData.filter((m: MatchScoreResult) => {
          const pA = (m.playerA || '').toLowerCase();
          const pB = (m.playerB || '').toLowerCase();
          if (!pA.includes(targetName) && !pB.includes(targetName)) return false;
          
          if (searchConfig.playerGender) {
             const fullText = (m.groupName + (m.itemType || '')).toUpperCase();
             if (searchConfig.playerGender === 'M' && (fullText.includes('女') || fullText.includes('WOMEN') || fullText.includes('GIRL'))) return false;
             if (searchConfig.playerGender === 'F' && (fullText.includes('男') || fullText.includes('MEN') || fullText.includes('BOY'))) return false;
          }
          return true;
      });
      
      if (hits.length > 0) {
          onProgress(`🎉 本地命中！找到 ${hits.length} 场记录`, 100);
          return hits;
      }
      onProgress(`⚠️ 本地比分库未找到 "${playerName}"，准备启动网络搜索...`, 28);
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
            keyword: playerName 
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

          // Double check filtering locally
          if (!p1.toLowerCase().includes(targetName) && !p2.toLowerCase().includes(targetName)) return; 

          if (searchConfig.playerGender) {
             const groupName = m.fullName || m.groupName || '';
             const itemType = m.itemType || m.itemName || '';
             const fullText = (groupName + itemType).toUpperCase();
             if (searchConfig.playerGender === 'M' && (fullText.includes('女') || fullText.includes('WOMEN') || fullText.includes('GIRL'))) return;
             if (searchConfig.playerGender === 'F' && (fullText.includes('男') || fullText.includes('MEN') || fullText.includes('BOY'))) return;
          }

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

          matchesInGame.push({
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
          });
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