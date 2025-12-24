import { ApiHeaderConfig, SearchConfig, GameBasicInfo, MatchItem, PlayerRank, MatchScoreResult } from '../types';

const CORS_PROXY_WARNING = "注意：从本地 Web 应用请求 ymq.me 通常需要开启 CORS 代理或浏览器插件（如 'Allow CORS'）。";

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

// --- Helper: Generate Default Keywords based on Birth Year ---
export const generateDefaultKeywords = (birthYear: number) => {
  const currentYear = new Date().getFullYear();
  const age = currentYear - birthYear;
  
  const keywords = [`U${age}`];
  
  if (age <= 7) keywords.push("丙");
  else if (age <= 9) keywords.push("乙");
  else if (age <= 11) keywords.push("甲");
  else if (age <= 13) keywords.push("少");

  return keywords.join(",");
};

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
  
  // --- CACHE LAYER OPTIMIZATION ---
  if (searchConfig.city.includes('广州') || searchConfig.province.includes('广东')) {
      try {
          onProgress("📡 正在尝试连接服务端离线数据库...", 5);
          const hourTs = Math.floor(Date.now() / (1000 * 60 * 60)); 
          const cacheRes = await fetch(`/daily_rankings.json?t=${hourTs}`); 
          
          if (cacheRes.ok) {
              onProgress("📥 数据库下载完成，正在解析...", 15);
              const cacheData = await cacheRes.json();
              
              if (cacheData && Array.isArray(cacheData.data) && cacheData.data.length > 0) {
                  const updateTimeStr = new Date(cacheData.updatedAt).toLocaleString();
                  onProgress(`✅ 解析成功 (${updateTimeStr} 更新)，正在筛选...`, 20);
                  
                  const groupKeys = searchConfig.groupKeywords.split(',').map(k => k.trim().toUpperCase()).filter(k => k);
                  const typeKeys = searchConfig.itemKeywords.split(',').map(k => k.trim()).filter(k => k);
                  
                  const gameKeywords = searchConfig.gameKeywords.split(',').map(k => k.trim()).filter(k => k);
                  const nameRegex = gameKeywords.length > 0 ? new RegExp(gameKeywords.join('|'), 'i') : null;
                  
                  const filtered = cacheData.data.filter((rank: PlayerRank) => {
                       // 1. Filter by Game Name (Loose)
                       if (nameRegex && !nameRegex.test(rank.game_name)) return false;

                       // 2. Filter by Group Name (Case Insensitive)
                       const gName = (rank.groupName || '').toUpperCase();
                       // Allow partial match
                       const matchGroup = groupKeys.length === 0 || groupKeys.some(k => gName.includes(k));
                       if (!matchGroup) return false;

                       // 3. Filter by Item Type (e.g. 男单)
                       if (typeKeys.length > 0) {
                           const matchType = typeKeys.some(k => gName.includes(k.toUpperCase())); 
                           if (!matchType) return false;
                       }
                       return true;
                  });

                  if (filtered.length > 0) {
                      onProgress(`🎉 离线库命中！提取到 ${filtered.length} 条数据 (无需访问 API)`, 100);
                      return { source: 'CACHE', data: filtered, updatedAt: updateTimeStr };
                  } else {
                      console.log("Cache loaded but filtered result is empty. Debug:", { groupKeys, typeKeys, sample: cacheData.data[0] });
                      onProgress("⚠️ 离线库中未找到符合条件的数据 (可能筛选条件过严)，转入实时抓取模式...", 10);
                  }
              }
          }
      } catch (e) {
          console.log("Ranking cache miss or error", e);
      }
  }

  // --- FALLBACK TO LIVE API ---
  onProgress("🔎 离线数据不可用，正在扫描华体汇实时赛事列表...", 10);
  const games = await fetchGameList(config, searchConfig);

  if (games.length === 0) {
      return { source: 'LIVE', data: [] };
  }

  onProgress(`✅ 锁定 ${games.length} 个相关赛事，开始实时抓取...`, 15);

  const groupKeys = searchConfig.groupKeywords.split(',').map(k => k.trim().toUpperCase()).filter(k => k);
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
        const iType = (item.itemType || '');
        const matchesGroup = groupKeys.some(k => gName.includes(k));
        const matchesType = typeKeys.length === 0 || typeKeys.some(k => iType.includes(k) || gName.includes(k));
        return matchesGroup && matchesType;
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
  // games: GameBasicInfo[], // Removed, now internal
  searchConfig: SearchConfig, // Added to support fallback game fetch
  onProgress: (msg: string, progress: number) => void
): Promise<MatchScoreResult[]> => {
  
  // Normalize Search Term
  const targetName = playerName.trim().toLowerCase();

  // --- CACHE LAYER OPTIMIZATION FOR MATCHES ---
  // Try to load full match history from daily static file first
  try {
      onProgress("🚀 正在下载服务端比分数据库 (Daily Matches)...", 5);
      const hourTs = Math.floor(Date.now() / (1000 * 60 * 60)); 
      const cacheRes = await fetch(`/daily_matches.json?t=${hourTs}`);
      
      if (cacheRes.ok) {
          onProgress("📥 数据库下载完成，正在本地索引...", 15);
          const cacheData = await cacheRes.json();
          
          if (cacheData && Array.isArray(cacheData.data) && cacheData.data.length > 0) {
              const totalRecords = cacheData.data.length;
              onProgress(`✅ 数据库索引完毕 (共 ${totalRecords} 条记录)，正在查找 "${playerName}"...`, 20);
              
              // Filter locally with loose matching
              const hits = cacheData.data.filter((m: MatchScoreResult) => {
                  const pA = (m.playerA || '').toLowerCase();
                  const pB = (m.playerB || '').toLowerCase();
                  return pA.includes(targetName) || pB.includes(targetName);
              });
              
              if (hits.length > 0) {
                  onProgress(`🎉 离线库检索成功！找到 ${hits.length} 场记录`, 100);
                  // Return sorted by date (if possible, currently matchTime is a string, assuming fetch order is roughly chronological)
                  return hits;
              } else {
                  // Explicit warning that we are falling back
                  console.log(`Cache miss for player: ${targetName}. Total records scanned: ${totalRecords}`);
                  onProgress(`⚠️ 离线库未收录 "${playerName}"，准备启动全网搜索 (较慢)...`, 10);
              }
          }
      }
  } catch(e) {
      console.log("Match cache miss, falling back to live", e);
  }

  // --- FALLBACK TO LIVE API ---
  onProgress("🔎 离线库未命中，正在扫描华体汇实时赛事列表...", 10);
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