import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Environment & Paths Configuration ---
const isDocker = process.env.IS_DOCKER === 'true';
const PORT = 3000;

// 1. Persistent Storage Directory
const dataDir = isDocker ? '/app/data' : path.resolve(__dirname, '../data');
// 2. Public Web Root
const publicDir = isDocker ? '/var/www/html' : path.resolve(__dirname, '../public');

const authPath = path.join(dataDir, 'auth_config.json');
const rankingsPath = path.join(dataDir, 'daily_rankings.json');
const matchesPath = path.join(dataDir, 'daily_matches.json');

const MANAGED_FILES = ['auth_config.json', 'daily_rankings.json', 'daily_matches.json'];

// 用户配置
const CREDENTIALS = {
  username: process.env.HTH_USER || '13261316191',
  password: process.env.HTH_PASS || 'Gao@2018.com'
};

const LOGIN_HANDSHAKE_HEADERS = {
    token: "DLFFG4-892b3448b953b5da525470ec2e5147d1202a126c",
    sn: "2b3467f4850c6743673871aa6c281f6a",
    from: "web"
};

const DATA_QUERY_SN = "9cc07cfedc454229063eb32c3045c5ae"; 

// --- Global State ---
let currentToken = "";

// [NEW] In-Memory Data Cache for API
let MEMORY_DB = {
    rankings: [], // Loaded from daily_rankings.json
    matches: [],  // Loaded from daily_matches.json
    lastUpdate: 0
};

// --- Express App Setup ---
const app = express();
app.use(cors());
app.use(express.json());

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

const normalize = (str) => (str || '').trim().toUpperCase();

// --- Initialization ---

function initEnvironment() {
    console.log(`📂 环境初始化:`);
    console.log(`   - 数据存储: ${dataDir}`);
    console.log(`   - Web发布: ${publicDir}`);

    if (!fs.existsSync(dataDir)) {
        try { fs.mkdirSync(dataDir, { recursive: true }); } catch(e) {}
    }
    if (!fs.existsSync(publicDir)) {
         try { fs.mkdirSync(publicDir, { recursive: true }); } catch(e) {}
    }

    const initData = { updatedAt: 0, dateString: "初始化中", count: 0, status: "initializing", data: [] };

    try {
        if (!fs.existsSync(rankingsPath)) fs.writeFileSync(rankingsPath, JSON.stringify(initData));
        if (!fs.existsSync(matchesPath)) fs.writeFileSync(matchesPath, JSON.stringify(initData));
    } catch (e) {}

    // Symlink logic preserved for Nginx fallback (optional now but good for backup)
    MANAGED_FILES.forEach(fileName => {
        const sourcePath = path.join(dataDir, fileName);
        const linkPath = path.join(publicDir, fileName);
        try {
            try { fs.unlinkSync(linkPath); } catch (e) {}
            if (fs.existsSync(sourcePath)) fs.symlinkSync(sourcePath, linkPath);
        } catch (e) {}
    });
}

function loadDataToMemory() {
    console.log("📥 正在将磁盘数据加载至内存...");
    try {
        if (fs.existsSync(rankingsPath)) {
            const rData = JSON.parse(fs.readFileSync(rankingsPath, 'utf-8'));
            MEMORY_DB.rankings = Array.isArray(rData.data) ? rData.data : [];
        }
        if (fs.existsSync(matchesPath)) {
            const mData = JSON.parse(fs.readFileSync(matchesPath, 'utf-8'));
            MEMORY_DB.matches = Array.isArray(mData.data) ? mData.data : [];
        }
        MEMORY_DB.lastUpdate = Date.now();
        console.log(`🧠 内存数据已刷新: 排名 ${MEMORY_DB.rankings.length} 条, 比分 ${MEMORY_DB.matches.length} 条`);
    } catch (e) {
        console.error("❌ 加载数据至内存失败:", e.message);
    }
}

// --- API Routes (Server Side Filtering) ---

// 1. Rankings Search API
app.get('/api/rankings', (req, res) => {
    const { 
        uKeywords, levelKeywords, itemKeywords, 
        gameKeywords, targetPlayerName, playerGender,
        province, city
    } = req.query;

    console.log(`🔍 [API/Rankings] Req Params:`, { gameKeywords, city, province });

    const results = MEMORY_DB.rankings.filter(item => {
        // 1. Province & City (Strict Check FIRST for performance)
        // If province/city param is provided, item MUST match.
        if (province && province.trim()) {
            if (!item.province || !normalize(item.province).includes(normalize(province))) return false;
        }
        if (city && city.trim()) {
            if (!item.city || !normalize(item.city).includes(normalize(city))) return false;
        }

        const fullText = normalize(
            (item.fullGroupName || '') + ' ' + 
            (item.groupName || '') + ' ' + 
            (item.itemType || '') + ' ' + 
            (item.name || item.itemName || '')
        );

        // 2. Gender
        if (playerGender) {
            if (playerGender === 'M' && !fullText.includes('男')) return false;
            if (playerGender === 'F' && !fullText.includes('女')) return false;
        }

        // 3. Group Logic (U-series OR Level)
        const uKeys = normalize(uKeywords).split(/[,，]/).filter(k => k);
        const levelKeys = normalize(levelKeywords).split(/[,，]/).filter(k => k);
        
        const hasU = uKeys.length > 0;
        const hasLevel = levelKeys.length > 0;

        const uMatch = hasU ? uKeys.some(k => fullText.includes(k)) : false;
        const levelMatch = hasLevel ? levelKeys.every(k => fullText.includes(k)) : false;

        if (hasU && hasLevel) {
            if (!uMatch && !levelMatch) return false;
        } else if (hasU) {
            if (!uMatch) return false;
        } else if (hasLevel) {
            if (!levelMatch) return false;
        }

        // 4. Item Type
        const itemKeys = normalize(itemKeywords).split(/[,，]/).filter(k => k);
        if (itemKeys.length > 0) {
            if (!itemKeys.some(k => fullText.includes(k))) return false;
        }

        // 5. Game Name (Explicitly checking item.game_name)
        const gameKeys = normalize(gameKeywords).split(/[,，]/).filter(k => k);
        if (gameKeys.length > 0) {
            const gameName = normalize(item.game_name || '');
            if (!gameKeys.some(k => gameName.includes(k))) return false;
        }

        // 6. Player Name
        if (targetPlayerName) {
            const target = normalize(targetPlayerName);
            const pName = normalize(item.playerName || '');
            if (!pName.includes(target)) return false;
        }

        return true;
    });

    // Limit results
    let finalData = results;
    const isUEmpty = !uKeywords || String(uKeywords).trim() === '';
    const isLevelEmpty = !levelKeywords || String(levelKeywords).trim() === '';
    const isItemEmpty = !itemKeywords || String(itemKeywords).trim() === '';
    const isPlayerEmpty = !targetPlayerName || String(targetPlayerName).trim() === '';

    if (isUEmpty && isLevelEmpty && isItemEmpty && isPlayerEmpty) {
        finalData = results.slice(0, 500);
    }

    res.json({
        source: 'API_MEMORY',
        count: finalData.length,
        updatedAt: new Date(MEMORY_DB.lastUpdate).toLocaleString(),
        data: finalData
    });
});

// 2. Matches Search API
app.get('/api/matches', (req, res) => {
    const { playerName, playerGender, gameKeywords, province, city } = req.query;

    if (!playerName) {
        return res.status(400).json({ error: "Missing playerName parameter" });
    }

    console.log(`🔍 [API/Matches] Req Params:`, { playerName, gameKeywords, city, province });

    const targetName = normalize(playerName);

    const results = MEMORY_DB.matches.filter(match => {
        // 1. Province & City Check (Priority)
        if (province && province.trim()) {
            if (!match.province || !normalize(match.province).includes(normalize(province))) return false;
        }
        if (city && city.trim()) {
            if (!match.city || !normalize(match.city).includes(normalize(city))) return false;
        }

        // 2. Player Name Check (Strict)
        const pA = normalize(match.playerA || match.mateOne || match.user1Name || '');
        const pB = normalize(match.playerB || match.mateTwo || match.user2Name || '');
        
        if (!pA.includes(targetName) && !pB.includes(targetName)) return false;

        // 3. Game Keywords (Explicitly checking match.game_name)
        const gameKeys = normalize(gameKeywords).split(/[,，]/).filter(k => k);
        if (gameKeys.length > 0) {
            const gameName = normalize(match.game_name || '');
            if (!gameKeys.some(k => gameName.includes(k))) return false;
        }

        // 4. Gender Filter
        if (playerGender) {
            const fullText = normalize(
                (match.fullName || '') + ' ' + 
                (match.groupName || '') + ' ' + 
                (match.itemType || '')
            );
            if (playerGender === 'M' && !fullText.includes('男')) return false;
            if (playerGender === 'F' && !fullText.includes('女')) return false;
        }

        return true;
    });

    res.json({
        source: 'API_MEMORY',
        count: results.length,
        updatedAt: new Date(MEMORY_DB.lastUpdate).toLocaleString(),
        data: results
    });
});

// --- Scraper Logic (Preserved) ---

async function loginAndSave() {
  console.log(`\n🔑 [${new Date().toLocaleString()}] 正在登录华体汇...`);
  const loginUrl = `https://user.ymq.me/public/public/login?t=${Date.now()}`;
  const requestTime = Date.now();
  const payload = {
      body: { identifier: CREDENTIALS.username, credential: CREDENTIALS.password, client_id: 1000, identity_type: 1 },
      header: { token: LOGIN_HANDSHAKE_HEADERS.token, sn: LOGIN_HANDSHAKE_HEADERS.sn, snTime: requestTime, from: LOGIN_HANDSHAKE_HEADERS.from }
  };
  try {
      const response = await fetch(loginUrl, { method: 'POST', headers: getHeaders(null), body: JSON.stringify(payload) });
      if (!response.ok) return false;
      const data = await response.json();
      if (data.code === 1 && data.userinfo && data.userinfo.token) {
          currentToken = data.userinfo.token;
          const configData = {
              token: currentToken, sn: DATA_QUERY_SN, snTime: Date.now(),
              username: data.userinfo.nickname || CREDENTIALS.username,
              updatedAt: new Date().toLocaleString(), updatedAtTs: Date.now(), status: "active"
          };
          fs.writeFileSync(authPath, JSON.stringify(configData, null, 2));
          return true;
      }
      return false;
  } catch (error) { return false; }
}

async function fetchGameList() {
    const url = `https://applyv3.ymq.me/public/public/getgamefulllist?t=${Date.now()}`;
    const requestBody = { page_num: 1, page_size: 200, sports_id: 1, status: [10], province: ["广东省"] };
    try {
        const res = await fetch(url, {
            method: 'POST', headers: getHeaders(currentToken),
            body: JSON.stringify({ body: requestBody, header: { token: currentToken, snTime: Date.now(), sn: DATA_QUERY_SN, from: "web" } })
        });
        const json = await res.json();
        if (json && json.data && Array.isArray(json.data.list)) {
             const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
             return json.data.list.filter(g => {
                if (g.end_game_time) return (g.end_game_time * 1000) > oneYearAgo;
                if (g.start_date) return new Date(g.start_date).getTime() > oneYearAgo;
                return false;
            });
        }
        return [];
    } catch (e) { return []; }
}

async function fetchRankingsForGame(game) {
    const allRanks = [];
    try {
        const fetchConfig = {
             method: 'POST', headers: getHeaders(currentToken, 'https://apply.ymq.me/'),
             body: JSON.stringify({ body: { raceId: game.id }, header: { token: currentToken, snTime: Date.now(), sn: DATA_QUERY_SN, from: "wx" } })
        };
        const [itemsRes, groupsRes] = await Promise.all([
            fetch('https://race.ymq.me/webservice/appWxRace/allItems.do', fetchConfig).catch(e => ({ json: () => ({ detail: [] }) })),
            fetch('https://race.ymq.me/webservice/appWxRace/allGroups.do', fetchConfig).catch(e => ({ json: () => ({ detail: [] }) }))
        ]);
        const itemsData = await itemsRes.json();
        const groupsData = await groupsRes.json();
        const itemsList = itemsData?.detail || [];
        const groupsList = groupsData?.detail || [];
        if (itemsList.length === 0 && groupsList.length === 0) return [];

        const processList = async (list, isGroup) => {
             for (const item of list) {
                const rankPayload = { raceId: game.id, groupId: isGroup ? item.id : null, itemId: isGroup ? null : item.id };
                const rankRes = await fetch('https://race.ymq.me/webservice/appWxRank/showRankScore.do', {
                    method: 'POST', headers: getHeaders(currentToken, 'https://apply.ymq.me/'),
                    body: JSON.stringify({ body: rankPayload, header: { token: currentToken, snTime: Date.now(), sn: DATA_QUERY_SN, from: "wx" } })
                });
                const rankData = await rankRes.json();
                if (rankData?.detail) {
                    rankData.detail.forEach(r => {
                        allRanks.push({
                            raceId: game.id, 
                            game_name: game.game_name,
                            province: game.province || '', // Added
                            city: game.city || '', // Added
                            groupName: `${item.groupName || ''} ${item.itemName || item.itemType || ''}`.trim() || '未知组别', 
                            fullGroupName: item.name || '',
                            playerName: r.playerName, rank: r.rank, score: r.score, club: r.club || r.teamName,
                            itemType: item.itemType, name: item.itemName
                        });
                    });
                }
                await wait(50); // Slightly faster in API server mode
             }
        };
        if (itemsList.length > 0) await processList(itemsList, false);
        if (groupsList.length > 0) await processList(groupsList, true);
    } catch (e) {}
    return allRanks;
}

async function fetchMatchesForGame(game) {
    const allMatches = [];
    let page = 1; let pageSize = 50; let hasMore = true;
    try {
        while (hasMore) {
            const res = await fetch(`https://race.ymq.me/webservice/appWxMatch/matchesScore.do?t=${Date.now()}`, {
                method: 'POST', headers: getHeaders(currentToken, 'https://apply.ymq.me/'),
                body: JSON.stringify({ body: { raceId: game.id, page: page, rows: pageSize, keyword: "" }, header: { token: currentToken, snTime: Date.now(), sn: DATA_QUERY_SN, from: "wx" } })
            });
            if (!res.ok) break;
            const json = await res.json();
            const rows = json?.detail?.rows || [];
            if (rows.length === 0) { hasMore = false; break; }
            rows.forEach(m => {
                const nameForLogic = m.fullName || m.groupName || '';
                const isDoublesOrTeam = nameForLogic.includes('双') || nameForLogic.includes('团');
                let p1 = '', p2 = '';
                if (isDoublesOrTeam) {
                    const comboName1 = m.mateOne || ''; const comboName2 = m.mateTwo || '';
                    const players1 = (Array.isArray(m.playerOnes) ? m.playerOnes : []).map(p => p.name).filter(n => n).join('/');
                    const players2 = (Array.isArray(m.playerTwos) ? m.playerTwos : []).map(p => p.name).filter(n => n).join('/');
                    p1 = (comboName1 && players1 && comboName1 !== players1) ? `${comboName1} (${players1})` : (comboName1 || players1);
                    p2 = (comboName2 && players2 && comboName2 !== players2) ? `${comboName2} (${players2})` : (comboName2 || players2);
                } else {
                    p1 = m.mateOne || (Array.isArray(m.playerOnes) && m.playerOnes.length > 0 ? m.playerOnes[0].name : '');
                    p2 = m.mateTwo || (Array.isArray(m.playerTwos) && m.playerTwos.length > 0 ? m.playerTwos[0].name : '');
                }
                let finalScore = "0:0";
                if (typeof m.scoreOne === 'number' && typeof m.scoreTwo === 'number') finalScore = `${m.scoreOne}:${m.scoreTwo}`;
                else if (m.score) finalScore = m.score;
                
                allMatches.push({
                    raceId: game.id, 
                    game_name: game.game_name, 
                    matchId: m.id,
                    province: game.province || '', // Added
                    city: game.city || '', // Added
                    fullName: m.fullName || m.groupName || '', groupName: m.groupName || m.fullName || '', 
                    playerA: p1 || '未知', playerB: p2 || '未知', score: finalScore,
                    matchTime: m.raceTimeName, round: m.roundName || m.rulesName
                });
            });
            if (rows.length < pageSize || (json.detail.total && allMatches.length >= json.detail.total)) hasMore = false;
            else { page++; await wait(50); }
        }
    } catch (e) {}
    return allMatches;
}

async function runDailyUpdate() {
    console.log(`\n📅 [${new Date().toLocaleString()}] >>> 开始执行数据更新任务 <<<`);
    const loginSuccess = await loginAndSave();
    if (!loginSuccess) { console.error("⛔ 登录失败"); return false; }

    const allGames = await fetchGameList();
    if (allGames.length === 0) return true;

    // Use Memory DB as truth, fallback to disk
    let existingRankData = MEMORY_DB.rankings;
    let existingMatchData = MEMORY_DB.matches;

    const rankedGameIds = new Set(existingRankData.map(r => r.raceId));
    const matchedGameIds = new Set(existingMatchData.map(m => m.raceId));

    let newRankings = [];
    let newMatches = [];
    let updatesMade = false;

    for (let i = 0; i < allGames.length; i++) {
        const game = allGames[i];
        if (rankedGameIds.has(game.id) && matchedGameIds.has(game.id)) continue;
        console.log(`Processing [${i+1}/${allGames.length}]: ${game.game_name}`);

        if (!rankedGameIds.has(game.id)) {
            const ranks = await fetchRankingsForGame(game);
            if (ranks.length > 0) { newRankings = newRankings.concat(ranks); updatesMade = true; }
            await wait(1000);
        }
        if (!matchedGameIds.has(game.id)) {
            const matches = await fetchMatchesForGame(game);
            if (matches.length > 0) { newMatches = newMatches.concat(matches); updatesMade = true; }
            await wait(1000);
        }
    }

    const now = Date.now();
    const dateStr = new Date().toLocaleString();

    if (!updatesMade) {
        console.log("✅ 数据已是最新，仅更新时间戳。");
        // Still verify files exist
    } else {
        const mergedRankings = [...existingRankData, ...newRankings];
        const mergedMatches = [...existingMatchData, ...newMatches];
        console.log(`💾 正在写入磁盘 (${dataDir})...`);
        // Removed root 'city' field as requested
        fs.writeFileSync(rankingsPath, JSON.stringify({ updatedAt: now, dateString: dateStr, count: mergedRankings.length, status: "active", data: mergedRankings }));
        fs.writeFileSync(matchesPath, JSON.stringify({ updatedAt: now, dateString: dateStr, count: mergedMatches.length, status: "active", data: mergedMatches }));
        console.log(`🎉 更新成功! 新增排名: ${newRankings.length}, 新增比分: ${newMatches.length}`);
    }
    
    // IMPORTANT: Reload Memory after update
    loadDataToMemory();
    return true;
}

function scheduleNextRun() {
    const now = new Date();
    const targetHourUTC = 21; // 5:00 AM Beijing
    let nextRun = new Date();
    nextRun.setUTCHours(targetHourUTC, 0, 0, 0);
    if (now > nextRun) nextRun.setDate(nextRun.getDate() + 1);
    
    setTimeout(async () => {
        try { await runDailyUpdate(); } catch (e) { console.error("Scheduled crash:", e); } finally { scheduleNextRun(); }
    }, nextRun.getTime() - now.getTime());
}

// --- Entry Point ---

(async () => {
    console.log("🟢 启动 Express API Server + 爬虫任务 (v2.0 API Mode)...");
    
    initEnvironment();
    loadDataToMemory();

    // Start API Server
    app.listen(PORT, () => {
        console.log(`🚀 API Server 运行在 http://localhost:${PORT}`);
    });

    // Start Background Scraper
    if (fs.existsSync(authPath)) {
        console.log("⏩ 后台爬虫：检测到配置，执行 Token 刷新...");
        await loginAndSave();
        // Optional: Run update on start if data is empty
        if (MEMORY_DB.rankings.length === 0) {
             console.log("⚠️ 内存无数据，触发全量爬取...");
             runDailyUpdate();
        }
    } else {
        console.log("⚡ 后台爬虫：首次运行，开始全量抓取...");
        await runDailyUpdate();
    }

    scheduleNextRun();
    setInterval(() => loginAndSave(), 2 * 60 * 60 * 1000); // 2h Token Refresh
})();