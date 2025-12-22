import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '../public');
const authPath = path.resolve(publicDir, 'auth_config.json');
const rankingsPath = path.resolve(publicDir, 'daily_rankings.json');
const matchesPath = path.resolve(publicDir, 'daily_matches.json');

// 用户配置
const CREDENTIALS = {
  username: process.env.HTH_USER || '13261316191',
  password: process.env.HTH_PASS || 'Gao@2018.com'
};

// 1. 登录专用固定配置
const LOGIN_HANDSHAKE_HEADERS = {
    token: "DLFFG4-892b3448b953b5da525470ec2e5147d1202a126c",
    sn: "2b3467f4850c6743673871aa6c281f6a",
    from: "web"
};

// 2. 数据查询专用固定 SN
const DATA_QUERY_SN = "9cc07cfedc454229063eb32c3045c5ae"; 

// --- Global State ---
let currentToken = "";

// --- Helper Functions ---
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const getHeaders = (token, referer = 'https://sports.ymq.me/') => ({
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'Origin': 'https://sports.ymq.me',
    'Referer': referer,
    'mode': 'cors',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36'
});

async function loginAndSave() {
  console.log(`\n[${new Date().toLocaleString()}] 🚀 开始执行登录流程...`);
  
  const loginUrl = `https://user.ymq.me/public/public/login?t=${Date.now()}`;
  const requestTime = Date.now();

  const payload = {
      body: {
          identifier: CREDENTIALS.username,
          credential: CREDENTIALS.password,
          client_id: 1000,
          identity_type: 1
      },
      header: {
          token: LOGIN_HANDSHAKE_HEADERS.token,
          sn: LOGIN_HANDSHAKE_HEADERS.sn,
          snTime: requestTime,
          from: LOGIN_HANDSHAKE_HEADERS.from
      }
  };

  try {
      const response = await fetch(loginUrl, {
          method: 'POST',
          headers: getHeaders(null),
          body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (data.code === 1 && data.userinfo && data.userinfo.token) {
          currentToken = data.userinfo.token;
          
          const configData = {
              token: currentToken,
              sn: DATA_QUERY_SN, 
              snTime: Date.now(),
              username: data.userinfo.nickname || CREDENTIALS.username,
              updatedAt: new Date().toLocaleString(),
              status: "active"
          };

          if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
          fs.writeFileSync(authPath, JSON.stringify(configData, null, 2));
          console.log(`✅ 登录成功，Token 已更新。`);
          return true;
      } else {
          console.error('❌ 登录失败:', data.message || '未知错误');
          return false;
      }
  } catch (error) {
      console.error('❌ 登录请求出错:', error);
      return false;
  }
}

// --- Scraper Functions ---

async function fetchGameList() {
    console.log("🔎 正在获取广州市已结束的赛事列表...");
    const url = `https://applyv3.ymq.me/public/public/getgamefulllist?t=${Date.now()}`;
    
    // 默认配置：广州，已结束 (statuss: 10)
    const requestBody = {
        page_num: 1,
        page_size: 100,
        statuss: [10], 
        province: ["广东省"],
        city: ["广州市"] 
    };

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: getHeaders(currentToken),
            body: JSON.stringify({
                body: requestBody,
                header: { token: currentToken, snTime: Date.now(), sn: DATA_QUERY_SN, from: "web" }
            })
        });
        const json = await res.json();
        if (json && json.data && Array.isArray(json.data.list)) {
            // 过滤掉太老的比赛，只保留最近一年的
            const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
            const recentGames = json.data.list.filter(g => {
                const gameDate = new Date(g.start_date).getTime();
                return gameDate > oneYearAgo;
            });
            console.log(`✅ 获取到 ${recentGames.length} 场近期已结束赛事。`);
            return recentGames;
        }
        return [];
    } catch (e) {
        console.error("fetchGameList error", e);
        return [];
    }
}

async function fetchRankingsForGame(game) {
    const allRanks = [];
    try {
        // 1. Get Items
        const itemsRes = await fetch('https://race.ymq.me/webservice/appWxRace/allItems.do', {
            method: 'POST',
            headers: getHeaders(currentToken, 'https://apply.ymq.me/'),
            body: JSON.stringify({
                body: { raceId: game.id },
                header: { token: currentToken, snTime: Date.now(), sn: DATA_QUERY_SN, from: "wx" }
            })
        });
        const itemsData = await itemsRes.json();
        
        if (!itemsData?.detail) return [];

        // 2. Loop Items
        for (const item of itemsData.detail) {
            const rankRes = await fetch('https://race.ymq.me/webservice/appWxRank/showRankScore.do', {
                method: 'POST',
                headers: getHeaders(currentToken, 'https://apply.ymq.me/'),
                body: JSON.stringify({
                    body: { raceId: game.id, groupId: null, itemId: item.id },
                    header: { token: currentToken, snTime: Date.now(), sn: DATA_QUERY_SN, from: "wx" }
                })
            });
            const rankData = await rankRes.json();
            
            if (rankData?.detail) {
                rankData.detail.forEach(r => {
                    allRanks.push({
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
            // Small delay to be polite
            await wait(150);
        }
    } catch (e) {
        console.warn(`Error scanning rankings for game ${game.id}: ${e.message}`);
    }
    return allRanks;
}

// New: Fetch Matches with Pagination
async function fetchMatchesForGame(game) {
    const allMatches = [];
    let page = 1;
    const pageSize = 50; // Use larger page size to reduce requests
    let hasMore = true;

    try {
        while (hasMore) {
            const url = `https://race.ymq.me/webservice/appWxMatch/matchesScore.do?t=${Date.now()}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: getHeaders(currentToken, 'https://apply.ymq.me/'),
                body: JSON.stringify({
                    body: {
                        raceId: game.id,
                        page: page,
                        rows: pageSize,
                        keyword: "" // Fetch ALL matches
                    },
                    header: { token: currentToken, snTime: Date.now(), sn: DATA_QUERY_SN, from: "wx" }
                })
            });
            
            if (!res.ok) break;
            const json = await res.json();
            const rows = json?.detail?.rows || [];
            
            if (rows.length === 0) {
                hasMore = false;
                break;
            }

            // Map and minimize data to save disk space
            rows.forEach(m => {
                let p1 = m.mateOne;
                if (!p1 && Array.isArray(m.playerOnes) && m.playerOnes.length > 0) p1 = m.playerOnes[0].name;
                
                let p2 = m.mateTwo;
                if (!p2 && Array.isArray(m.playerTwos) && m.playerTwos.length > 0) p2 = m.playerTwos[0].name;

                let finalScore = "0:0";
                if (typeof m.scoreOne === 'number' && typeof m.scoreTwo === 'number') {
                    finalScore = `${m.scoreOne}:${m.scoreTwo}`;
                } else if (m.score) {
                    finalScore = m.score;
                }

                allMatches.push({
                    raceId: game.id,
                    game_name: game.game_name,
                    matchId: m.id,
                    groupName: m.fullName || m.groupName,
                    playerA: p1 || '未知选手A',
                    playerB: p2 || '未知选手B',
                    score: finalScore,
                    matchTime: m.raceTimeName,
                    round: m.roundName || m.rulesName
                });
            });

            // Check if we reached the end
            if (rows.length < pageSize || (json.detail.total && allMatches.length >= json.detail.total)) {
                hasMore = false;
            } else {
                page++;
                await wait(200); // 200ms delay between pages
            }
        }
    } catch (e) {
        console.warn(`Error scanning matches for game ${game.id}: ${e.message}`);
    }
    
    console.log(`    > 🏟️ ${game.game_name}: 获取到 ${allMatches.length} 场比赛比分`);
    return allMatches;
}

async function runDailyUpdate() {
    console.log(`\n📅 [${new Date().toLocaleString()}] 开始执行每日数据更新...`);
    
    // 1. Ensure logged in
    const loginSuccess = await loginAndSave();
    if (!loginSuccess) return;

    // 2. Fetch Latest Games List
    const allGames = await fetchGameList();
    if (allGames.length === 0) {
        console.log("⚠️ 没有找到赛事，跳过更新。");
        return;
    }

    // 3. --- LOAD EXISTING DATA ---
    let existingRankData = [];
    let existingMatchData = [];
    
    // Load Rankings
    if (fs.existsSync(rankingsPath)) {
        try {
            const rContent = fs.readFileSync(rankingsPath, 'utf-8');
            const parsed = JSON.parse(rContent);
            if (parsed && Array.isArray(parsed.data)) {
                existingRankData = parsed.data;
            }
        } catch (e) { console.error("Error reading rankings cache:", e.message); }
    }
    
    // Load Matches
    if (fs.existsSync(matchesPath)) {
         try {
            const mContent = fs.readFileSync(matchesPath, 'utf-8');
            const parsed = JSON.parse(mContent);
            if (parsed && Array.isArray(parsed.data)) {
                existingMatchData = parsed.data;
            }
        } catch (e) { console.error("Error reading matches cache:", e.message); }
    }

    // 4. --- INCREMENTAL CHECK LOGIC ---
    // Decouple checks: We might have rankings but lack matches for the same game
    const rankedGameIds = new Set(existingRankData.map(r => r.raceId));
    const matchedGameIds = new Set(existingMatchData.map(m => m.raceId));

    console.log(`📦 本地缓存状态:`);
    console.log(`   - 排名已收录: ${rankedGameIds.size} 场赛事`);
    console.log(`   - 比分已收录: ${matchedGameIds.size} 场赛事`);

    let newRankings = [];
    let newMatches = [];
    let updatesMade = false;

    console.log(`🚀 开始对比并增量抓取...`);

    for (let i = 0; i < allGames.length; i++) {
        const game = allGames[i];
        const hasRank = rankedGameIds.has(game.id);
        const hasMatch = matchedGameIds.has(game.id);

        if (hasRank && hasMatch) {
            // Data is complete for this game
            continue;
        }

        console.log(`[${i+1}/${allGames.length}] 检查: ${game.game_name}`);

        // A. Fetch Rankings if missing
        if (!hasRank) {
            console.log(`    --> ⚠️ 缺失排名数据，正在抓取...`);
            const ranks = await fetchRankingsForGame(game);
            if (ranks.length > 0) {
                newRankings = newRankings.concat(ranks);
                updatesMade = true;
            }
            await wait(1000); 
        }

        // B. Fetch Matches if missing
        if (!hasMatch) {
            console.log(`    --> ⚠️ 缺失比分数据，正在抓取...`);
            const matches = await fetchMatchesForGame(game);
            if (matches.length > 0) {
                newMatches = newMatches.concat(matches);
                updatesMade = true;
            }
            await wait(1000);
        }
    }

    if (!updatesMade) {
        console.log("✅ 所有近期赛事的排名和比分均为最新，无需更新。");
        // Update timestamp on files to indicate system is alive
        const now = Date.now();
        const dateStr = new Date().toLocaleString();
        
        fs.writeFileSync(rankingsPath, JSON.stringify({ updatedAt: now, dateString: dateStr, count: existingRankData.length, city: "广州市", data: existingRankData }));
        fs.writeFileSync(matchesPath, JSON.stringify({ updatedAt: now, dateString: dateStr, count: existingMatchData.length, city: "广州市", data: existingMatchData }));
        return;
    }

    // 5. Merge & Save
    let mergedRankings = [...existingRankData, ...newRankings];
    let mergedMatches = [...existingMatchData, ...newMatches];
    
    const now = Date.now();
    const dateStr = new Date().toLocaleString();

    // Save Rankings
    const rankPayload = {
        updatedAt: now,
        dateString: dateStr,
        count: mergedRankings.length,
        city: "广州市",
        data: mergedRankings
    };
    fs.writeFileSync(rankingsPath, JSON.stringify(rankPayload));

    // Save Matches
    const matchPayload = {
        updatedAt: now,
        dateString: dateStr,
        count: mergedMatches.length,
        city: "广州市",
        data: mergedMatches
    };
    fs.writeFileSync(matchesPath, JSON.stringify(matchPayload));

    console.log(`\n🎉 增量更新完成!`);
    if (newRankings.length > 0) console.log(`   + 新增排名: ${newRankings.length} 条`);
    if (newMatches.length > 0) console.log(`   + 新增比分: ${newMatches.length} 条`);
    console.log(`💾 数据已持久化到磁盘。`);
}

// --- Robust Scheduler ---
function scheduleNextRun() {
    const now = new Date();
    
    // Target: Next 5:00 AM (Beijing/Shanghai Time, UTC+8) -> UTC 21:00 previous day
    const targetHourUTC = 21; 
    
    let nextRun = new Date();
    nextRun.setUTCHours(targetHourUTC, 0, 0, 0);
    
    if (now > nextRun) {
        nextRun.setDate(nextRun.getDate() + 1);
    }
    
    const delay = nextRun.getTime() - now.getTime();
    const hours = Math.floor(delay / (1000 * 60 * 60));
    const minutes = Math.floor((delay % (1000 * 60 * 60)) / (1000 * 60));
    
    console.log(`⏰ 定时器已设定。下次更新将在: ${nextRun.toISOString()} (约 ${hours}小时${minutes}分后)`);
    
    setTimeout(async () => {
        try {
            await runDailyUpdate();
        } catch (e) {
            console.error("Daily update failed:", e);
        } finally {
            scheduleNextRun();
        }
    }, delay);
}

// --- Init ---

// 1. Initial Data Check
if (!fs.existsSync(rankingsPath)) {
    console.log("📂 未发现缓存文件，3秒后执行首次全量抓取...");
    setTimeout(runDailyUpdate, 3000); 
} else {
    // Run update on start to catch up if container was down, then schedule
    console.log("⚡ 系统启动，正在检查数据完整性...");
    setTimeout(runDailyUpdate, 3000);
}

// 2. Start Scheduler
scheduleNextRun();

// 3. Token Refresh (Keep session alive)
setInterval(loginAndSave, 2 * 60 * 60 * 1000);