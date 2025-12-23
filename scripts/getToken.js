import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// 在 Docker 中, /app/public 是软链接指向 /var/www/html
const publicDir = path.resolve(__dirname, '../public');
const authPath = path.resolve(publicDir, 'auth_config.json');
const rankingsPath = path.resolve(publicDir, 'daily_rankings.json');
const matchesPath = path.resolve(publicDir, 'daily_matches.json');

// 用户配置
const CREDENTIALS = {
  username: process.env.HTH_USER || '13261316191',
  password: process.env.HTH_PASS || 'Gao@2018.com'
};

// 1. 登录专用固定配置 (来自抓包)
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
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
});

// --- Initialization ---
function initPlaceholderFiles() {
    console.log(`📂 初始化路径: ${publicDir}`);
    
    // 尝试创建目录（如果不存在）
    if (!fs.existsSync(publicDir)) {
        console.log("   目录不存在，尝试创建...");
        try { fs.mkdirSync(publicDir, { recursive: true }); } catch(e) { console.error("   创建目录失败 (可能是软链接):", e.message); }
    }

    const initData = {
        updatedAt: Date.now(),
        dateString: new Date().toLocaleString(),
        count: 0,
        city: "初始化中",
        status: "initializing",
        data: []
    };

    // 强制写入占位符，确保文件存在
    try {
        if (!fs.existsSync(rankingsPath)) {
            fs.writeFileSync(rankingsPath, JSON.stringify(initData));
            console.log("   + 已创建 daily_rankings.json");
        }
        if (!fs.existsSync(matchesPath)) {
            fs.writeFileSync(matchesPath, JSON.stringify(initData));
            console.log("   + 已创建 daily_matches.json");
        }
    } catch (e) {
        console.error("   ❌ 初始化文件写入失败:", e.message);
    }
}

async function loginAndSave() {
  console.log(`\n🔑 [${new Date().toLocaleString()}] 正在登录华体汇...`);
  
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

      if (!response.ok) {
           console.error(`❌ 登录 HTTP 错误: ${response.status}`);
           const text = await response.text();
           console.error(`   响应内容: ${text.substring(0, 100)}`);
           return false;
      }

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

          fs.writeFileSync(authPath, JSON.stringify(configData, null, 2));
          console.log(`✅ 登录成功! Token前缀: ${currentToken.substring(0, 6)}...`);
          return true;
      } else {
          console.error('❌ 登录 API 拒绝:', data.message || JSON.stringify(data));
          return false;
      }
  } catch (error) {
      console.error('❌ 登录网络请求异常:', error.message);
      return false;
  }
}

// --- Scraper Functions ---

async function fetchGameList() {
    console.log("🔎 获取赛事列表 (范围: 广东省广州市)...");
    const url = `https://applyv3.ymq.me/public/public/getgamefulllist?t=${Date.now()}`;
    
    // 严格限制：广东省 广州市
    // 新增 sports_id: 1 (羽毛球), 修复数据获取为空的问题
    const requestBody = {
        page_num: 1,
        page_size: 100,
        sports_id: 1,  
        statuss: [10], // 已结束
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
            const list = json.data.list;
            // 打印第一条数据的日期，用于调试
            if (list.length > 0) {
                console.log(`   API 首条数据日期: ${list[0].start_date} | 名称: ${list[0].game_name}`);
            }

            console.log(`   API 返回 ${list.length} 个广州赛事。正在筛选近一年数据...`);

            const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
            
            const recentGames = list.filter(g => {
                const gameDate = new Date(g.start_date).getTime();
                return gameDate > oneYearAgo;
            });

            console.log(`✅ 筛选出 ${recentGames.length} 场近期已结束赛事。`);
            return recentGames;
        } else {
            console.warn("⚠️ 赛事列表 API 返回格式异常或为空:", JSON.stringify(json).substring(0, 100));
        }
        return [];
    } catch (e) {
        console.error("fetchGameList 异常:", e.message);
        return [];
    }
}

async function fetchRankingsForGame(game) {
    const allRanks = [];
    try {
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
            await wait(100);
        }
    } catch (e) {
        console.warn(`   ⚠️ [${game.game_name}] 排名抓取部分失败: ${e.message}`);
    }
    return allRanks;
}

async function fetchMatchesForGame(game) {
    const allMatches = [];
    let page = 1;
    const pageSize = 50;
    let hasMore = true;

    try {
        while (hasMore) {
            const res = await fetch(`https://race.ymq.me/webservice/appWxMatch/matchesScore.do?t=${Date.now()}`, {
                method: 'POST',
                headers: getHeaders(currentToken, 'https://apply.ymq.me/'),
                body: JSON.stringify({
                    body: { raceId: game.id, page: page, rows: pageSize, keyword: "" },
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

            if (rows.length < pageSize || (json.detail.total && allMatches.length >= json.detail.total)) {
                hasMore = false;
            } else {
                page++;
                await wait(100);
            }
        }
    } catch (e) {
        console.warn(`   ⚠️ [${game.game_name}] 比分抓取部分失败: ${e.message}`);
    }
    
    return allMatches;
}

async function runDailyUpdate() {
    console.log(`\n📅 [${new Date().toLocaleString()}] >>> 开始执行数据更新任务 <<<`);
    
    const loginSuccess = await loginAndSave();
    if (!loginSuccess) {
        console.error("⛔ 登录失败，终止本次更新。");
        return false; 
    }

    const allGames = await fetchGameList();
    if (allGames.length === 0) {
        console.log("⚠️ 没有找到符合条件的赛事，更新结束。");
        // 即使没有赛事，也视为成功执行了一次检查
        return true; 
    }

    // Load Existing Data
    let existingRankData = [];
    let existingMatchData = [];
    
    if (fs.existsSync(rankingsPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(rankingsPath, 'utf-8'));
            if (Array.isArray(data.data)) existingRankData = data.data;
        } catch (e) {}
    }
    
    if (fs.existsSync(matchesPath)) {
         try {
            const data = JSON.parse(fs.readFileSync(matchesPath, 'utf-8'));
            if (Array.isArray(data.data)) existingMatchData = data.data;
        } catch (e) {}
    }

    const rankedGameIds = new Set(existingRankData.map(r => r.raceId));
    const matchedGameIds = new Set(existingMatchData.map(m => m.raceId));

    let newRankings = [];
    let newMatches = [];
    let updatesMade = false;

    console.log(`📊 现有数据: 排名 ${rankedGameIds.size} 场, 比分 ${matchedGameIds.size} 场`);

    for (let i = 0; i < allGames.length; i++) {
        const game = allGames[i];
        const hasRank = rankedGameIds.has(game.id);
        const hasMatch = matchedGameIds.has(game.id);

        if (hasRank && hasMatch) continue;

        console.log(`Processing [${i+1}/${allGames.length}]: ${game.game_name}`);

        if (!hasRank) {
            const ranks = await fetchRankingsForGame(game);
            if (ranks.length > 0) {
                newRankings = newRankings.concat(ranks);
                updatesMade = true;
                console.log(`   + 抓取到 ${ranks.length} 条排名`);
            }
            await wait(1000); 
        }

        if (!hasMatch) {
            const matches = await fetchMatchesForGame(game);
            if (matches.length > 0) {
                newMatches = newMatches.concat(matches);
                updatesMade = true;
                console.log(`   + 抓取到 ${matches.length} 条比分`);
            }
            await wait(1000);
        }
    }

    const now = Date.now();
    const dateStr = new Date().toLocaleString();

    if (!updatesMade) {
        console.log("✅ 数据已是最新，仅更新时间戳。");
        try {
            const rPayload = { updatedAt: now, dateString: dateStr, count: existingRankData.length, city: "广州市", status: "active", data: existingRankData };
            const mPayload = { updatedAt: now, dateString: dateStr, count: existingMatchData.length, city: "广州市", status: "active", data: existingMatchData };
            fs.writeFileSync(rankingsPath, JSON.stringify(rPayload));
            fs.writeFileSync(matchesPath, JSON.stringify(mPayload));
        } catch(e) { console.error("Write error:", e.message); }
        return true;
    }

    const mergedRankings = [...existingRankData, ...newRankings];
    const mergedMatches = [...existingMatchData, ...newMatches];
    
    console.log(`💾 正在写入磁盘...`);
    try {
        fs.writeFileSync(rankingsPath, JSON.stringify({
            updatedAt: now, dateString: dateStr, count: mergedRankings.length, city: "广州市", status: "active", data: mergedRankings
        }));
        fs.writeFileSync(matchesPath, JSON.stringify({
            updatedAt: now, dateString: dateStr, count: mergedMatches.length, city: "广州市", status: "active", data: mergedMatches
        }));
        console.log(`🎉 更新成功! 新增排名: ${newRankings.length}, 新增比分: ${newMatches.length}`);
    } catch(e) {
        console.error("❌ 写入文件失败:", e.message);
    }
    return true;
}

// --- Robust Scheduler ---
function scheduleNextRun() {
    const now = new Date();
    // 目标: 北京时间 凌晨 05:00
    // UTC时间: 21:00 (前一天)
    const targetHourUTC = 21; 
    
    let nextRun = new Date();
    nextRun.setUTCHours(targetHourUTC, 0, 0, 0);
    
    if (now > nextRun) {
        nextRun.setDate(nextRun.getDate() + 1);
    }
    
    const delay = nextRun.getTime() - now.getTime();
    const hours = (delay / (1000 * 60 * 60)).toFixed(1);
    
    console.log(`⏰ 下次定时更新已排程: ${nextRun.toISOString()} (约 ${hours} 小时后)`);
    
    setTimeout(async () => {
        try {
            await runDailyUpdate();
        } catch (e) {
            console.error("Scheduled update crash:", e);
        } finally {
            scheduleNextRun();
        }
    }, delay);
}

// --- Entry Point ---

(async () => {
    console.log("🟢 脚本启动...");
    
    // 1. 初始化文件
    initPlaceholderFiles();

    // 2. 立即执行首次检查
    console.log(`⚡ 执行启动时更新...`);
    let initialSuccess = false;
    try {
        initialSuccess = await runDailyUpdate();
    } catch(e) {
        console.error("Startup update crashed:", e);
    }

    // 3. 重试逻辑 (失败 31 分钟后重试一次)
    if (!initialSuccess) {
        console.log("⚠️ 启动时更新未成功，将在 31 分钟后尝试重试...");
        await wait(31 * 60 * 1000); 
        
        console.log("🔄 开始执行重试更新...");
        try {
            const retrySuccess = await runDailyUpdate();
            if (retrySuccess) console.log("✅ 重试更新成功。");
            else console.error("❌ 重试更新依然失败，等待次日定时任务。");
        } catch(e) {
            console.error("Retry update crashed:", e);
        }
    } else {
        console.log("✅ 启动时更新成功。");
    }

    // 4. 启动定时器 (无论首次成功与否，都要保证第二天的任务被调度)
    scheduleNextRun();
    
    // 5. 保持 Token 活跃 (每2小时)
    setInterval(() => {
        console.log("💓 Token 保活检查...");
        loginAndSave();
    }, 2 * 60 * 60 * 1000);

})();
