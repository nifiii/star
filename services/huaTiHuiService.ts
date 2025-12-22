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
// Execute promises in parallel with a limit to avoid overwhelming the browser/server
async function pLimit<T>(items: any[], limit: number, fn: (item: any, index: number) => Promise<T>): Promise<T[]> {
  const results: T[] = [];
  const executing: Promise<void>[] = [];
  
  for (let i = 0; i < items.length; i++) {
    const p = fn(items[i], i).then(r => { results.push(r); });
    executing.push(p);
    
    if (executing.length >= limit) {
      await Promise.race(executing); // Wait for one to finish
      // Clean up finished promises (not strictly necessary for simple usage but good practice)
      // For simplicity here, we just wait for the race. In a full implementation we'd remove the finished one.
      // But since we can't easily identify which one finished in Promise.race without wrapper, 
      // we'll just use a simplified batching or standard semaphore approach.
      // Let's use a simpler "Chunking" approach for stability in this context.
    }
  }
  // Wait for the rest
  await Promise.all(executing);
  return results;
}

// Simpler Batch helper for readability and stability
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
  
  // Logic based on prompt:
  // 6,7 -> 丙
  // 8,9 -> 乙
  // 10,11 -> 甲
  if (age <= 7) keywords.push("丙");
  else if (age <= 9) keywords.push("乙");
  else if (age <= 11) keywords.push("甲");
  else if (age <= 13) keywords.push("少"); // General assumption

  return keywords.join(",");
};

// 1. Get Game Full List
export const fetchGameList = async (config: ApiHeaderConfig, searchConfig: SearchConfig): Promise<GameBasicInfo[]> => {
  const url = `https://applyv3.ymq.me/public/public/getgamefulllist?t=${config.snTime || Date.now()}`;
  
  // --- Normalize Province and City Logic ---
  let rawProvince = searchConfig.province.trim();
  let rawCity = searchConfig.city.trim();

  const municipalities = ['北京', '上海', '天津', '重庆'];
  
  // Determine if inputs relate to a Municipality
  // Case 1: Province field matches "Beijing", "Beijing Shi", etc.
  const provMuniMatch = municipalities.find(m => rawProvince.startsWith(m));
  // Case 2: City field matches "Beijing" (User might put it in city field accidentally or intentionally)
  const cityMuniMatch = municipalities.find(m => rawCity.startsWith(m));

  let finalProvince = "";
  let finalCity = "";

  if (provMuniMatch) {
    // If it is a municipality, normalize name to "XX市" and CLEAR the city field
    finalProvince = provMuniMatch + "市";
    finalCity = ""; 
  } else if (cityMuniMatch) {
    // If user typed municipality in City field, move it to Province and clear City
    finalProvince = cityMuniMatch + "市";
    finalCity = "";
  } else {
    // Normal Province Logic
    if (rawProvince) {
      // If it ends with 市 (rare for non-municipality provinces) or 省, keep it. Otherwise add 省.
      // Note: Some autonomous regions (Guangxi, etc.) might need special handling, but per prompt instructions:
      // "Input box is province, must add keyword 省"
      if (rawProvince.endsWith('省') || rawProvince.endsWith('市')) {
        finalProvince = rawProvince;
      } else {
        finalProvince = rawProvince + '省';
      }
    }

    // Normal City Logic
    if (rawCity) {
      // Add '市' if missing, preserve suffixes like '区', '盟', '州'
      if (!rawCity.endsWith('市') && !rawCity.endsWith('区') && !rawCity.endsWith('盟') && !rawCity.endsWith('州')) {
        finalCity = rawCity + '市';
      } else {
        finalCity = rawCity;
      }
    }
  }

  // Construct Body dynamically
  // If finalCity is empty (which happens for Municipalities), we OMIT the city key entirely.
  const requestBody: any = {
    page_num: 1,
    page_size: 100, 
    statuss: [10], // Filter for "Ended" games (10)
    province: finalProvince ? [finalProvince] : [],
  };

  if (finalCity) {
    requestBody.city = [finalCity];
  }

  const payload = {
    body: requestBody,
    header: { token: config.token, snTime: config.snTime, sn: config.sn, from: "web" }
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: getHeaders(config),
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error(`API Error: ${response.status}`);
    const data = await response.json();
    
    // Generate Regex from Keywords (comma separated -> OR logic)
    const keywords = searchConfig.gameKeywords.split(',').map(k => k.trim()).filter(k => k);
    const nameRegex = keywords.length > 0 ? new RegExp(keywords.join('|')) : null;

    if (data && data.data && Array.isArray(data.data.list)) {
      return data.data.list
        .filter((game: any) => nameRegex ? nameRegex.test(game.game_name) : true)
        .map((game: any) => ({
          id: game.id,
          game_name: game.game_name,
          start_date: game.start_date
        }));
    }
    return [];
  } catch (error) {
    console.error("Fetch Game List Error", error);
    throw new Error(`获取赛事列表失败。${CORS_PROXY_WARNING}`);
  }
};

// 2. Fetch Rankings (OPTIMIZED: Concurrent Batches)
export const fetchAggregatedRankings = async (
  config: ApiHeaderConfig, 
  searchConfig: SearchConfig,
  games: GameBasicInfo[],
  onProgress: (msg: string, progress: number) => void
): Promise<PlayerRank[]> => {
  const groupKeys = searchConfig.groupKeywords.split(',').map(k => k.trim().toUpperCase()).filter(k => k);
  const typeKeys = searchConfig.itemKeywords.split(',').map(k => k.trim()).filter(k => k);

  let processedCount = 0;
  
  // Process games in batches of 5 to speed up
  const results = await runInBatches(games, 5, async (game, index) => {
    const ranksInGame: PlayerRank[] = [];
    
    try {
      // Update progress slightly delayed to not flood React state
      if (index % 2 === 0) {
        processedCount = index + 1;
        onProgress(`正在极速扫描: ${game.game_name}`, Math.floor((processedCount / games.length) * 50));
      }

      // A. Get Items (Groups)
      const itemsUrl = 'https://race.ymq.me/webservice/appWxRace/allItems.do';
      const itemsRes = await fetch(itemsUrl, {
        method: 'POST',
        headers: getHeaders(config, 'https://apply.ymq.me/'),
        body: JSON.stringify({
          body: { raceId: game.id },
          header: { token: config.token, snTime: config.snTime, sn: config.sn, from: "wx" }
        })
      });
      const itemsData = await itemsRes.json();
      
      if (!itemsData?.detail) return [];

      // Filter relevant groups
      const relevantItems = itemsData.detail.filter((item: any) => {
        const gName = (item.groupName || '').toUpperCase();
        const iType = (item.itemType || '');
        const matchesGroup = groupKeys.some(k => gName.includes(k));
        const matchesType = typeKeys.length === 0 || typeKeys.some(k => iType.includes(k) || gName.includes(k));
        return matchesGroup && matchesType;
      });

      // B. Get Rankings for each relevant group (Concurrent inner)
      // Usually there are only 1-3 relevant groups per game, so Promise.all is safe here
      await Promise.all(relevantItems.map(async (item: any) => {
        try {
          const rankUrl = 'https://race.ymq.me/webservice/appWxRank/showRankScore.do';
          const rankRes = await fetch(rankUrl, {
            method: 'POST',
            headers: getHeaders(config, 'https://apply.ymq.me/'),
            body: JSON.stringify({
              body: { raceId: game.id, groupId: null, itemId: item.id },
              header: { token: config.token, snTime: config.snTime, sn: config.sn, from: "wx" }
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
        } catch (innerE) {
           // ignore specific group fetch error
        }
      }));

    } catch (e) {
      console.warn(`Error scanning game ${game.id}`, e);
    }
    return ranksInGame;
  });
  
  // Flatten array
  return results.flat();
};

// 3. Fetch Matches (OPTIMIZED: Concurrent Batches)
export const fetchPlayerMatches = async (
  config: ApiHeaderConfig,
  playerName: string,
  games: GameBasicInfo[],
  onProgress: (msg: string, progress: number) => void
): Promise<MatchScoreResult[]> => {
  let processedCount = 0;

  const results = await runInBatches(games, 8, async (game, index) => {
    const matchesInGame: MatchScoreResult[] = [];
    
    // Update UI less frequently
    if (index % 3 === 0) {
       processedCount = index;
       onProgress(`正在全网检索: ${game.game_name}`, Math.floor((processedCount / games.length) * 100));
    }

    const url = `https://race.ymq.me/webservice/appWxMatch/matchesScore.do?t=${config.snTime || Date.now()}`;
    
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: getHeaders(config, 'https://apply.ymq.me/'),
        body: JSON.stringify({
          body: {
            raceId: game.id,
            page: 1,
            rows: 50, 
            keyword: playerName // Filtering by name on server side
          },
          header: { token: config.token, snTime: config.snTime, sn: config.sn, from: "wx" }
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

          if (!p1.includes(playerName) && !p2.includes(playerName)) return; 

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

// MOCK DATA
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