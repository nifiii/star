import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '../public');
const authPath = path.resolve(publicDir, 'auth_config.json');
const dataPath = path.resolve(publicDir, 'daily_rankings.json');

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
        console.warn(`Error scanning game ${game.id}: ${e.message}`);
    }
    return allRanks;
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

    // 3. --- INCREMENTAL LOGIC ---
    let existingData = [];
    let existingGameIds = new Set();
    
    if (fs.existsSync(dataPath)) {
        try {
            const fileContent = fs.readFileSync(dataPath, 'utf-8');
            const parsed = JSON.parse(fileContent);
            if (parsed && Array.isArray(parsed.data)) {
                existingData = parsed.data;
                // Create a Set of existing RaceIDs
                existingData.forEach(r => existingGameIds.add(r.raceId));
                console.log(`📦 已加载本地缓存: 包含 ${existingGameIds.size} 场赛事的 ${existingData.length} 条记录。`);
            }
        } catch (e) {
            console.error("读取现有缓存失败，将重新抓取全量数据:", e.message);
        }
    }

    // Identify NEW games that are NOT in existingData
    const gamesToFetch = allGames.filter(g => !existingGameIds.has(g.id));

    if (gamesToFetch.length === 0) {
        console.log("✅ 没有发现新的已结束赛事。缓存已是最新状态。");
        // Update timestamp even if data hasn't changed
        const cachePayload = {
            updatedAt: Date.now(),
            dateString: new Date().toLocaleString(),
            count: existingData.length,
            city: "广州市",
            data: existingData
        };
        fs.writeFileSync(dataPath, JSON.stringify(cachePayload));
        return;
    }

    console.log(`🚀 发现 ${gamesToFetch.length} 场新赛事，开始增量抓取...`);

    // 4. Fetch ONLY new games
    let newRankings = [];
    for (let i = 0; i < gamesToFetch.length; i++) {
        const game = gamesToFetch[i];
        console.log(`[${i+1}/${gamesToFetch.length}] New Scan: ${game.game_name}`);
        const ranks = await fetchRankingsForGame(game);
        newRankings = newRankings.concat(ranks);
        await wait(1000); // 1s interval
    }

    // 5. Merge & Prune
    // Merge new data with old data
    let mergedData = [...existingData, ...newRankings];
    
    // Optional: Prune very old data from the cache file (e.g. keep only last 12 months)
    // For now, we keep everything to build a long history.

    // 6. Save to Disk
    const cachePayload = {
        updatedAt: Date.now(),
        dateString: new Date().toLocaleString(),
        count: mergedData.length,
        city: "广州市",
        data: mergedData
    };

    fs.writeFileSync(dataPath, JSON.stringify(cachePayload));
    console.log(`\n🎉 增量更新完成! 新增 ${newRankings.length} 条，总计 ${mergedData.length} 条。`);
    console.log(`💾 文件保存至: ${dataPath}`);
}

// --- Robust Scheduler ---
function scheduleNextRun() {
    const now = new Date();
    
    // Target: Next 5:00 AM (Beijing/Shanghai Time, UTC+8)
    // Container time is likely UTC. 5 AM CN = 21:00 UTC previous day.
    // Let's rely on local time logic relative to where the node process thinks it is.
    // If user set timezone in Docker, this works naturally. If UTC, we target 21:00 UTC.
    
    // We'll target 21:00 UTC (which is 05:00 Beijing) to be safe for Docker default.
    const targetHourUTC = 21; 
    
    let nextRun = new Date();
    nextRun.setUTCHours(targetHourUTC, 0, 0, 0);
    
    // If 21:00 UTC today has passed, schedule for tomorrow
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
            // Schedule the next one recursively to prevent drift
            scheduleNextRun();
        }
    }, delay);
}

// --- Init ---

// 1. Immediate Login
loginAndSave();

// 2. Initial Data Check
if (!fs.existsSync(dataPath)) {
    console.log("📂 未发现缓存文件，3秒后执行首次全量抓取...");
    setTimeout(runDailyUpdate, 3000); 
} else {
    // If file exists, check if we missed today's run? 
    // Simplified: Just run schedule. User can manually run if needed.
}

// 3. Start Scheduler
scheduleNextRun();

// 4. Token Refresh (Keep session alive)
setInterval(loginAndSave, 2 * 60 * 60 * 1000);