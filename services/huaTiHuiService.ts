import { ApiHeaderConfig, SearchConfig, GameBasicInfo, MatchItem, PlayerRank, MatchScoreResult } from '../types';

const CORS_PROXY_WARNING = "注意：从本地 Web 应用请求 ymq.me 通常需要开启 CORS 代理或浏览器插件（如 'Allow CORS'）。";

// --- GLOBAL MEMORY CACHE (Session Level) ---
// Prevents re-downloading the large JSON files if the user searches multiple times in one session.
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

// 1. Get Game Full List (Internal or direct use)
export const fetchGameList = async (config: ApiHeaderConfig, searchConfig: SearchConfig): Promise<GameBasicInfo[]> => {
  const effectiveSnTime = Date.now();
  
  const url = `https://applyv3.ymq.me/public/public/getgamefulllist?t=${effectiveSnTime}`;
  
  let rawProvince = searchConfig.province.trim();
  let rawCity = searchConfig.city.trim();

  const municipalities = ['北京', '上海', '天津', '重庆'];
  
  const provMuniMatch = municipalities.find(m => rawProvince.startsWith(m));
  const cityMuniMatch = municipalities.find(m => rawCity.startsWith(m));

  let finalProvince = "";
  let finalCity = "";

  if (provMuniMatch) {
    finalProvince = provMuniMatch + "市";
    finalCity = ""; 
  } else if (cityMuniMatch) {
    finalProvince = cityMuniMatch + "市";
    finalCity = "";
  } else {
    if (rawProvince) {
      if (rawProvince.endsWith('省') || rawProvince.endsWith('市')) {
        finalProvince = rawProvince;
      } else {
        finalProvince = rawProvince + '省';
      }
    }

    if (rawCity) {
      if (!rawCity.endsWith('市') && !rawCity.endsWith('区') && !rawCity.endsWith('盟') && !rawCity.endsWith('州')) {
        finalCity = rawCity + '市';
      } else {
        finalCity = rawCity;
      }
    }
  }

  const requestBody: any = {
    page_num: 1,
    page_size: 100, 
    statuss: [10], // Filter for "Ended" games
    province: finalProvince ? [finalProvince] : [],
  };

  if (finalCity) {
    requestBody.city = [finalCity];
  }

  const payload = {
    body: requestBody,
    header: { 
      token: config.token, 
      snTime: effectiveSnTime, // Use current timestamp
      sn: config.sn,           // Use fixed SN from config
      from: "web" 
    }
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: getHeaders(config),
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error(`API Error: ${response.status}`);
    const data = await response.json();
    
    // Loose regex matching for Game Names
    const keywords = searchConfig.gameKeywords.split(',').map(k => k.trim()).filter(k => k);
    // If keywords exist, create regex. If empty, match all.
    const nameRegex = keywords.length > 0 ? new RegExp(keywords.join('|'), 'i') : null;

    if (data && data.data && Array.isArray(data.data.list)) {
      return data.data.list
        .filter((game: any) => nameRegex ? nameRegex.test(game.game_name) : true)
        .map((game: any) => ({
          id: game.id,
          game_name: game.game_name,
          // Fallback to end_game_time if start_date is null/empty
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
  
  // --- TIER 1: CHECK MEMORY & SERVER FILE ---
  // Only check cache if the search is for Guangzhou/Guangdong (Server DB limitation)
  if (searchConfig.city.includes('广州') || searchConfig.province.includes('广东')) {
      try {
          let sourceData: PlayerRank[] = [];
          let updateTimeStr = '';

          // A. Check In-Memory Cache first
          if (MEMORY_CACHE.rankings && (Date.now() - MEMORY_CACHE.rankings.timestamp < MEMORY_CACHE_TTL)) {
              onProgress("🧠 读取内存中的榜单数据...", 10);
              sourceData = MEMORY_CACHE.rankings.data;
              updateTimeStr = '刚刚 (内存)';
          } else {
              // B. Download Server File
              onProgress("📡 正在从服务器下载离线榜单库 (daily_rankings.json)...", 5);
              const hourTs = Math.floor(Date.now() / (1000 * 60 * 60)); 
              const cacheRes = await fetch(`/daily_rankings.json?t=${hourTs}`); 
              
              if (cacheRes.ok) {
                  const cacheData = await cacheRes.json();
                  if (cacheData && Array.isArray(cacheData.data)) {
                       if (cacheData.status === 'initializing' || (cacheData.data.length === 0 && cacheData.count === 0)) {
                           onProgress("⏳ 服务端缓存文件初始化中，跳过...", 10);
                       } else {
                           sourceData = cacheData.data;
                           updateTimeStr = new Date(cacheData.updatedAt).toLocaleString();
                           // Save to Memory
                           MEMORY_CACHE.rankings = { data: sourceData, timestamp: Date.now() };
                           onProgress("📥 榜单库下载完毕，已缓存至内存。", 15);
                       }
                  }
              }
          }

          // C. Filter Data (Query Logic)
          if (sourceData.length > 0) {
                  onProgress(`🔍 正在筛选 ${sourceData.length} 条记录...`, 20);
                  
                  const uKeys = searchConfig.uKeywords.split(',').map(k => k.trim().toUpperCase()).filter(k => k);
                  const levelKeys = searchConfig.levelKeywords.split(',').map(k => k.trim().toUpperCase()).filter(k => k);
                  const typeKeys = searchConfig.itemKeywords.split(',').map(k => k.trim()).filter(k => k);
                  const gameKeywords = searchConfig.gameKeywords.split(',').map(k => k.trim()).filter(k => k);
                  const nameRegex = gameKeywords.length > 0 ? new RegExp(gameKeywords.join('|'), 'i') : null;
                  
                  // NEW: Player Name Filter
                  const targetName = (searchConfig.targetPlayerName || '').trim();

                  const filtered = sourceData.filter((rank: PlayerRank) => {
                       if (nameRegex && !nameRegex.test(rank.game_name)) return false;

                       // Check player name if provided
                       if (targetName && !rank.playerName.includes(targetName)) return false;

                       const gName = (rank.groupName || '').toUpperCase();
                       const hasUFilters = uKeys.length > 0;
                       const hasLevelFilters = levelKeys.length > 0;
                       
                       let groupMatched = true;
                       if (hasUFilters || hasLevelFilters) {
                          const matchesU = hasUFilters && uKeys.some(k => gName.includes(k));
                          const matchesLevel = hasLevelFilters && levelKeys.every(k => gName.includes(k));

                          if (hasUFilters && !hasLevelFilters) groupMatched = matchesU;
                          else if (!hasUFilters && hasLevelFilters) groupMatched = matchesLevel;
                          else groupMatched = matchesU || matchesLevel;
                       }

                       if (!groupMatched) return false;

                       if (typeKeys.length > 0) {
                           const rAny = rank as any;
                           const fullText = ((rAny.groupName || '') + ' ' + (rAny.game_name || '') + ' ' + (rAny.itemType || '') + ' ' + (rAny.itemName || '')).toUpperCase();
                           const matchType = typeKeys.some(k => fullText.includes(k.toUpperCase())); 
                           if (!matchType) return false;
                       }
                       return true;
                  });

                  if (filtered.length > 0) {
                      onProgress(`🎉 离线库命中！提取到 ${filtered.length} 条数据 (无需访问 API)`, 100);
                      return { source: 'CACHE', data: filtered, updatedAt: updateTimeStr };
                  } else {
                      onProgress(`⚠️ 离线库筛选结果为空，准备转入实时搜索模式...`, 10);
                  }
          }
      } catch (e) {
          console.log("Ranking cache miss or error", e);
      }
  } else {
    onProgress("🌐 检测到非广州地区查询，直接连接华体汇实时数据...", 5);
  }

  // --- TIER 3: LIVE API FALLBACK ---
  onProgress("🔎 正在扫描华体汇实时赛事列表...", 10);
  const games = await fetchGameList(config, searchConfig);

  if (games.length === 0) {
      return { source: 'LIVE', data: [] };
  }

  onProgress(`✅ 锁定 ${games.length} 个相关赛事，开始实时抓取...`, 15);

  const uKeys = searchConfig.uKeywords.split(',').map(k => k.trim().toUpperCase()).filter(k => k);
  const levelKeys = searchConfig.levelKeywords.split(',').map(k => k.trim().toUpperCase()).filter(k => k);
  const typeKeys = searchConfig.itemKeywords.split(',').map(k => k.trim()).filter(k => k);
  
  let processedCount = 0;
  
  const results = await runInBatches(games, 5, async (game, index) => {
    const ranksInGame: PlayerRank[] = [];
    try {
      if (index % 2 === 0) {
        processedCount = index + 1;
        onProgress(`[实时爬虫] 正在扫描: ${game.game_name} (${processedCount}/${games.length})`, Math.floor((processedCount / games.length) * 50) + 10);
      }
      const effectiveSnTime = Date.now();
      const itemsUrl = 'https://race.ymq.me/webservice/appWxRace/allItems.do';
      const itemsRes = await fetch(itemsUrl, {
        method: 'POST',
        headers: getHeaders(config, 'https://apply.ymq.me/'),
        body: JSON.stringify({
          body: { raceId: game.id },
          header: { token: config.token, snTime: effectiveSnTime, sn: config.sn, from: "wx" }
        })
      });
      const itemsData = await itemsRes.json();
      
      if (!itemsData?.detail) return [];

      const relevantItems = itemsData.detail.filter((item: any) => {
        const gName = (item.groupName || '').toUpperCase();
        const iType = (item.itemType || item.itemName || '').toUpperCase(); 
        
        const hasUFilters = uKeys.length > 0;
        const hasLevelFilters = levelKeys.length > 0;
        let groupMatched = true;

        if (hasUFilters || hasLevelFilters) {
           const matchesU = hasUFilters && uKeys.some(k => gName.includes(k));
           const matchesLevel = hasLevelFilters && levelKeys.every(k => gName.includes(k));
           if (hasUFilters && !hasLevelFilters) groupMatched = matchesU;
           else if (!hasUFilters && hasLevelFilters) groupMatched = matchesLevel;
           else groupMatched = matchesU || matchesLevel;
        }

        if (!groupMatched) return false;
        const matchesType = typeKeys.length === 0 || typeKeys.some(k => iType.includes(k) || gName.includes(k));
        return matchesType;
      });

      await Promise.all(relevantItems.map(async (item: any) => {
        try {
          const rankUrl = 'https://race.ymq.me/webservice/appWxRank/showRankScore.do';
          const rankRes = await fetch(rankUrl, {
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
              // NEW: Filter by player name if provided
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
  
  // --- TIER 1: CHECK MEMORY & SERVER FILE ---
  const isCacheRegion = searchConfig.city.includes('广州') || searchConfig.province.includes('广东');

  if (isCacheRegion) {
    try {
        let sourceData: MatchScoreResult[] = [];

        // A. Check In-Memory Cache First
        if (MEMORY_CACHE.matches && (Date.now() - MEMORY_CACHE.matches.timestamp < MEMORY_CACHE_TTL)) {
             onProgress("🧠 读取内存中的比分数据库...", 10);
             sourceData = MEMORY_CACHE.matches.data;
        } else {
             // B. Download Server File to Memory
             onProgress("🚀 正在下载服务端比分数据库 (daily_matches.json)...", 5);
             const hourTs = Math.floor(Date.now() / (1000 * 60 * 60)); 
             const cacheRes = await fetch(`/daily_matches.json?t=${hourTs}`);
             
             if (cacheRes.ok) {
                 const cacheData = await cacheRes.json();
                 if (cacheData && Array.isArray(cacheData.data)) {
                    if (cacheData.status === 'initializing' || (cacheData.data.length === 0 && cacheData.count === 0)) {
                         onProgress("⏳ 服务端比分库初始化中，跳过...", 10);
                    } else {
                         sourceData = cacheData.data;
                         // Store to Memory Cache
                         MEMORY_CACHE.matches = { data: sourceData, timestamp: Date.now() };
                         onProgress(`📥 比分库下载完成，已缓存至内存 (共 ${sourceData.length} 条)。`, 15);
                    }
                 }
             }
        }

        // C. Filter (Query Logic)
        if (sourceData.length > 0) {
                onProgress(`🔎 正在离线库中检索 "${playerName}"...`, 20);
                
                const hits = sourceData.filter((m: MatchScoreResult) => {
                    const pA = (m.playerA || '').toLowerCase();
                    const pB = (m.playerB || '').toLowerCase();
                    const nameMatch = pA.includes(targetName) || pB.includes(targetName);
                    
                    if (!nameMatch) return false;
                    
                    // Gender Filter Logic
                    if (searchConfig.playerGender) {
                       const fullText = (m.groupName + (m.itemType || '')).toUpperCase();
                       if (searchConfig.playerGender === 'M') {
                           if (fullText.includes('女') || fullText.includes('WOMEN') || fullText.includes('GIRL')) return false;
                       } else if (searchConfig.playerGender === 'F') {
                           if (fullText.includes('男') || fullText.includes('MEN') || fullText.includes('BOY')) return false;
                       }
                    }
                    return true;
                });
                
                if (hits.length > 0) {
                    onProgress(`🎉 离线库检索成功！找到 ${hits.length} 场记录`, 100);
                    return hits;
                } else {
                    onProgress(`⚠️ 离线库未找到 "${playerName}"。正在转为全网实时搜索...`, 10);
                }
        }
    } catch(e) {
        console.log("Match cache miss, falling back to live", e);
    }
  } else {
    onProgress("🌐 检测到非广州地区查询，跳过离线库，准备启动全网搜索...", 5);
  }

  // --- TIER 3: LIVE API FALLBACK ---
  onProgress("🔎 正在扫描华体汇实时赛事列表...", 10);
  const games = await fetchGameList(config, searchConfig);

  if (games.length === 0) return [];
  onProgress(`✅ 锁定 ${games.length} 个相关赛事，开始实时检索...`, 15);

  let processedCount = 0;

  const results = await runInBatches(games, 8, async (game, index) => {
    const matchesInGame: MatchScoreResult[] = [];
    
    if (index % 3 === 0) {
       processedCount = index;
       const percent = Math.floor((processedCount / games.length) * 100);
       onProgress(`[实时爬虫] 正在检索赛事: ${game.game_name} (${percent}%)`, percent);
    }

    const effectiveSnTime = Date.now();
    const url = `https://race.ymq.me/webservice/appWxMatch/matchesScore.do?t=${effectiveSnTime}`;
    
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: getHeaders(config, 'https://apply.ymq.me/'),
        body: JSON.stringify({
          body: {
            raceId: game.id,
            page: 1,
            rows: 50, 
            keyword: playerName // API might be strict, but we pass original
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
             if (searchConfig.playerGender === 'M') {
                 if (fullText.includes('女') || fullText.includes('WOMEN') || fullText.includes('GIRL')) return;
             } else if (searchConfig.playerGender === 'F') {
                 if (fullText.includes('男') || fullText.includes('MEN') || fullText.includes('BOY')) return;
             }
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