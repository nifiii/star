import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Environment & Paths Configuration ---
const isDocker = process.env.IS_DOCKER === 'true';

// 1. Persistent Storage Directory (Where files actually live)
// In Docker: /app/data (Mounted Volume)
// Local: ../data
const dataDir = isDocker ? '/app/data' : path.resolve(__dirname, '../data');

// 2. Public Web Root (Where Nginx serves files from)
// In Docker: /var/www/html
// Local: ../public
const publicDir = isDocker ? '/var/www/html' : path.resolve(__dirname, '../public');

// File Paths (Pointing to Storage)
const authPath = path.join(dataDir, 'auth_config.json');
const rankingsPath = path.join(dataDir, 'daily_rankings.json');
const matchesPath = path.join(dataDir, 'daily_matches.json');

const MANAGED_FILES = ['auth_config.json', 'daily_rankings.json', 'daily_matches.json'];

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

// --- Initialization & Persistence ---

function initEnvironment() {
    console.log(`📂 环境初始化:`);
    console.log(`   - 数据存储: ${dataDir}`);
    console.log(`   - Web发布: ${publicDir}`);

    // 1. Ensure directories exist
    if (!fs.existsSync(dataDir)) {
        console.log("   + 创建数据存储目录...");
        try { fs.mkdirSync(dataDir, { recursive: true }); } catch(e) { console.error("   ❌ 创建数据目录失败:", e.message); }
    }
    if (!fs.existsSync(publicDir)) {
         // Local dev might need this
         try { fs.mkdirSync(publicDir, { recursive: true }); } catch(e) {}
    }

    // 2. Initialize Placeholder Files if missing in Storage
    const initData = {
        updatedAt: 0, // 0 indicates stale/init
        dateString: "初始化中",
        count: 0,
        city: "初始化中",
        status: "initializing",
        data: []
    };

    try {
        if (!fs.existsSync(rankingsPath)) fs.writeFileSync(rankingsPath, JSON.stringify(initData));
        if (!fs.existsSync(matchesPath)) fs.writeFileSync(matchesPath, JSON.stringify(initData));
        // auth_config handled by login
    } catch (e) {
        console.error("   ❌ 初始化文件写入失败:", e.message);
    }

    // 3. Create Symlinks: Storage -> WebRoot
    // This allows Nginx to serve files located in the persistent Volume
    console.log("   🔗 正在建立文件映射...");
    MANAGED_FILES.forEach(fileName => {
        const sourcePath = path.join(dataDir, fileName);
        const linkPath = path.join(publicDir, fileName);

        try {
            // Remove existing link or file in WebRoot to avoid conflicts
            // Correct Logic: Try to access it, if no error, it exists -> delete it.
            try {
                fs.lstatSync(linkPath); // Throws if not found
                fs.unlinkSync(linkPath); // Delete if found
            } catch (e) {
                if (e.code !== 'ENOENT') throw e; // Only ignore "not found"
            }
        } catch(e) {
             console.error(`      ⚠️ 清理旧文件失败 ${fileName}:`, e.message);
        }

        try {
            if (fs.existsSync(sourcePath)) {
                fs.symlinkSync(sourcePath, linkPath);
            }
        } catch (e) {
            console.error(`      ❌ 映射失败 ${fileName}:`, e.message);
        }
    });
}

function isDataFresh() {
    try {
        // 1. 检查 Auth 配置是否存在且新鲜
        if (fs.existsSync(authPath)) {
            const data = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
            if (data.updatedAt) {
                // Check if updated within last 4 hours
                const lastUpdate = new Date(data.updatedAt).getTime();
                const diffHours = (Date.now() - lastUpdate) / (1000 * 60 * 60);
                
                // 如果 Auth Token 太旧 (> 4 小时)，则不新鲜，需要重新登录
                if (diffHours >= 4) {
                    return false;
                }

                // 2. [新增] 检查数据文件内容状态
                // 即使 Auth 是新的（比如容器刚重启或没有删 auth 文件），
                // 如果数据文件是 "initializing" 状态（比如用户刚执行了 rm 删除），则必须强制更新。
                try {
                    if (fs.existsSync(rankingsPath)) {
                        const rankData = JSON.parse(fs.readFileSync(rankingsPath, 'utf-8'));
                        if (rankData.status === 'initializing') {
                            console.log("   ⚠️ 检测到数据文件处于初始化状态，强制执行更新...");
                            return false; 
                        }
                    } else {
                         // 文件不存在，肯定不新鲜
                         return false; 
                    }
                } catch(e) {
                    // 读取或解析数据文件失败，视为不新鲜
                    return false; 
                }

                console.log(`✨ 数据依然新鲜 (上次更新: ${diffHours.toFixed(2)} 小时前)`);
                return true;
            }
        }
    } catch (e) {
        console.warn("   ⚠️ 检查数据新鲜度失败:", e.message);
    }
    return false;
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
              updatedAt: new Date().toLocaleString(), // Store formatted string
              updatedAtTs: Date.now(), // Store timestamp for logic
              status: "active"
          };

          fs.writeFileSync(authPath, JSON.stringify(configData, null, 2));
          // Re-link auth file just in case
          try {
             const linkPath = path.join(publicDir, 'auth_config.json');
             if (!fs.existsSync(linkPath)) fs.symlinkSync(authPath, linkPath);
          } catch(e) {}

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
    // 新增 sports_id: 1 (羽毛球)
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
            
            if (list.length > 0) {
                const sampleGame = list[0];
                let debugDate = '未知';
                
                if (sampleGame.end_game_time) {
                    debugDate = new Date(sampleGame.end_game_time * 1000).toLocaleDateString();
                } else if (sampleGame.start_date) {
                    debugDate = sampleGame.start_date;
                }
                
                console.log(`   API 首条数据日期: ${debugDate} | 名称: ${sampleGame.game_name}`);
            }

            console.log(`   API 返回 ${list.length} 个广州赛事。正在筛选近一年数据...`);

            const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
            
            const recentGames = list.filter(g => {
                if (g.end_game_time) {
                    const gameTime = g.end_game_time * 1000;
                    return gameTime > oneYearAgo;
                }
                if (g.start_date) {
                    const gameDate = new Date(g.start_date).getTime();
                    return gameDate > oneYearAgo;
                }
                return false;
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
        const fetchConfig = {
             method: 'POST',
             headers: getHeaders(currentToken, 'https://apply.ymq.me/'),
             body: JSON.stringify({
                 body: { raceId: game.id },
                 header: { token: currentToken, snTime: Date.now(), sn: DATA_QUERY_SN, from: "wx" }
             })
        };

        // 1. 同时请求 Items (单项) 和 Groups (团体)
        const [itemsRes, groupsRes] = await Promise.all([
            fetch('https://race.ymq.me/webservice/appWxRace/allItems.do', fetchConfig).catch(e => ({ json: () => ({ detail: [] }) })),
            fetch('https://race.ymq.me/webservice/appWxRace/allGroups.do', fetchConfig).catch(e => ({ json: () => ({ detail: [] }) }))
        ]);
        
        const itemsData = await itemsRes.json();
        const groupsData = await groupsRes.json();
        
        // 2. 合并数据源
        const itemsList = itemsData?.detail || [];
        const groupsList = groupsData?.detail || [];
        
        // 如果两者都为空，直接返回
        if (itemsList.length === 0 && groupsList.length === 0) return [];

        // 3. 统一处理列表的辅助函数
        const processList = async (list, isGroup) => {
             for (const item of list) {
                const rankPayload = {
                    raceId: game.id,
                    groupId: isGroup ? item.id : null,
                    itemId: isGroup ? null : item.id
                };

                const rankRes = await fetch('https://race.ymq.me/webservice/appWxRank/showRankScore.do', {
                    method: 'POST',
                    headers: getHeaders(currentToken, 'https://apply.ymq.me/'),
                    body: JSON.stringify({
                        body: rankPayload,
                        header: { token: currentToken, snTime: Date.now(), sn: DATA_QUERY_SN, from: "wx" }
                    })
                });
                const rankData = await rankRes.json();
                
                if (rankData?.detail) {
                    rankData.detail.forEach(r => {
                        const gName = item.groupName || '';
                        const iName = item.itemName || item.itemType || '';
                        const extendedGroupName = `${gName} ${iName}`.trim();
                        
                        allRanks.push({
                            raceId: game.id,
                            game_name: game.game_name,
                            groupName: extendedGroupName || '未知组别', 
                            playerName: r.playerName,
                            rank: r.rank,
                            score: r.score,
                            club: r.club || r.teamName,
                            itemType: item.itemType, 
                            name: item.itemName
                        });
                    });
                }
                await wait(100);
             }
        };

        // 4. 分别处理
        if (itemsList.length > 0) {
            await processList(itemsList, false);
        }
        
        if (groupsList.length > 0) {
            console.log(`   ℹ️ [${game.game_name}] 发现团体/分组数据 (${groupsList.length} 项)`);
            await processList(groupsList, true);
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
                // Determine raw name for logic check (Double/Team)
                // Do not assign this to both fields to avoid duplication error
                const nameForLogic = m.fullName || m.groupName || '';
                
                // 1. 判断是否为双打或团体 (根据 fullName 是否包含 双 或 团)
                const isDoublesOrTeam = nameForLogic.includes('双') || nameForLogic.includes('团');

                let p1 = '';
                let p2 = '';

                if (isDoublesOrTeam) {
                    // --- 双打/团体逻辑 ---
                    // mateOne/mateTwo 通常为 "组合名称" (如: 张三/李四 或 飞羽一队)
                    const comboName1 = m.mateOne || '';
                    const comboName2 = m.mateTwo || '';

                    // playerOnes/playerTwos 为具体选手列表
                    // 提取选手名称并用 / 拼接
                    const players1 = (Array.isArray(m.playerOnes) ? m.playerOnes : [])
                        .map(p => p.name).filter(n => n).join('/');
                    const players2 = (Array.isArray(m.playerTwos) ? m.playerTwos : [])
                        .map(p => p.name).filter(n => n).join('/');

                    // 组合展示逻辑: 
                    // 如果有组合名且跟选手列表不一样，则展示 "组合名 (选手1/选手2)"
                    // 否则直接展示选手列表 (如果没有选手列表，就展示组合名)
                    if (comboName1 && players1 && comboName1 !== players1) {
                        p1 = `${comboName1} (${players1})`;
                    } else {
                        p1 = comboName1 || players1;
                    }

                    if (comboName2 && players2 && comboName2 !== players2) {
                        p2 = `${comboName2} (${players2})`;
                    } else {
                        p2 = comboName2 || players2;
                    }
                } else {
                    // --- 单打逻辑 ---
                    // 优先取 mateOne，没有则取 playerOnes 数组第一个
                    p1 = m.mateOne;
                    if (!p1 && Array.isArray(m.playerOnes) && m.playerOnes.length > 0) {
                        p1 = m.playerOnes[0].name;
                    }

                    p2 = m.mateTwo;
                    if (!p2 && Array.isArray(m.playerTwos) && m.playerTwos.length > 0) {
                        p2 = m.playerTwos[0].name;
                    }
                }

                // 兜底
                p1 = p1 || '未知选手A';
                p2 = p2 || '未知选手B';

                // 分数处理
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
                    // Use cross-fallback to ensure fields are populated but distinct if possible
                    fullName: m.fullName || m.groupName || '', 
                    groupName: m.groupName || m.fullName || '', 
                    playerA: p1,
                    playerB: p2,
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
    
    console.log(`💾 正在写入磁盘 (${dataDir})...`);
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
    console.log("🟢 脚本启动 (v1.0.3 - Enhanced Item Capture)...");
    
    // 1. 初始化环境 (目录 & 链接)
    initEnvironment();

    // 2. 检查是否需要运行启动时更新
    // 如果数据足够新鲜 (4小时内)，则跳过更新，只刷新 Token
    if (isDataFresh()) {
        console.log("⏩ 跳过启动时爬取任务，仅执行 Token 保活...");
        await loginAndSave();
    } else {
        console.log(`⚡ 执行启动时更新 (全量检查)...`);
        try {
            await runDailyUpdate();
        } catch(e) {
            console.error("Startup update crashed:", e);
        }
    }

    // 3. 启动定时器
    scheduleNextRun();
    
    // 4. 保持 Token 活跃 (每2小时)
    setInterval(() => {
        console.log("💓 Token 保活检查...");
        loginAndSave();
    }, 2 * 60 * 60 * 1000);

})();