import React, { useState, useEffect } from 'react';
import { ApiHeaderConfig, SearchConfig, StepStatus, MatchScoreResult, PlayerRank, LogEntry, AppView, GameBasicInfo, UserCredentials, DataCache } from './types';
import ConfigPanel from './components/ConfigPanel';
import LogViewer from './components/LogViewer';
import { fetchGameList, fetchAggregatedRankings, fetchPlayerMatches, getMockRanks, getMockMatches } from './services/huaTiHuiService';
import { analyzeData } from './services/geminiService';
import { Download, ArrowLeft, Trophy, BarChart2, Sparkles, X, Medal, Smile, Frown, Lightbulb } from 'lucide-react';
import * as XLSX from 'xlsx';
import ReactMarkdown from 'react-markdown';

// --- CONSTANTS FOR PERSISTENCE ---
const STORAGE_KEY_CONFIG = 'hth_config_v1';
const STORAGE_KEY_SEARCH = 'hth_search_v1';
const STORAGE_KEY_CREDS = 'hth_creds_v1';
const STORAGE_PREFIX_CACHE = 'hth_cache_';
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 Hours

const INITIAL_CONFIG: ApiHeaderConfig = {
  token: '',
  sn: '',
  snTime: Date.now(),
};

const INITIAL_CREDENTIALS: UserCredentials = {
  isLoggedIn: false
};

const INITIAL_SEARCH_CONFIG: SearchConfig = {
  birthYear: 2017, // 8 years old in 2025
  province: "广东省",
  city: "广州市",
  gameKeywords: "少年,小学",
  groupKeywords: 'U8,乙',
  itemKeywords: '男单',
  targetPlayerName: ''
};

const App: React.FC = () => {
  // State
  const [config, setConfig] = useState<ApiHeaderConfig>(INITIAL_CONFIG);
  const [userCredentials, setUserCredentials] = useState<UserCredentials>(INITIAL_CREDENTIALS);
  const [searchConfig, setSearchConfig] = useState<SearchConfig>(INITIAL_SEARCH_CONFIG);
  
  const [view, setView] = useState<AppView>('DASHBOARD_RANKS');
  const [status, setStatus] = useState<StepStatus>(StepStatus.IDLE);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [progress, setProgress] = useState(0);
  const [hasAuthError, setHasAuthError] = useState(false);

  // Data Cache
  const [cachedGames, setCachedGames] = useState<GameBasicInfo[]>([]);
  const [rankings, setRankings] = useState<PlayerRank[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [matchHistory, setMatchHistory] = useState<MatchScoreResult[]>([]);
  const [lastCacheTime, setLastCacheTime] = useState<string>('');

  // Analysis
  const [playerAnalysis, setPlayerAnalysis] = useState<string>("");
  const [dashboardAnalysis, setDashboardAnalysis] = useState<string>("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // --- Persistence Effects ---
  
  const fetchCredentials = async (isManual = false) => {
    try {
      // Add timestamp to prevent caching 404s or old data
      const res = await fetch(`/auth_config.json?t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const autoData = await res.json();
        
        // Handle "Initializing" state from backend script
        if (autoData.status === 'initializing') {
            if (isManual) addLog("⏳ 后台脚本正在启动初始化，请稍候再试...", "info");
            return;
        }

        if (autoData.token) {
            setConfig(prev => ({
              ...prev,
              token: autoData.token,
              sn: autoData.sn || prev.sn,
              snTime: Date.now() // Frontend always uses current time
            }));
            setUserCredentials(prev => ({
              ...prev,
              isLoggedIn: true,
              username: autoData.username || prev.username || 'Auto-User'
            }));
            
            setHasAuthError(false); // Clear error if successful fetch
            
            if (isManual) {
               addLog("🔄 已重新加载最新凭证。", "success");
            } else {
               addLog("🤖 系统已连接。", "success");
            }
        }
      } else {
         if (isManual) addLog("⚠️ 未找到配置文件 (404)。请运行: npm run get-token", "error");
      }
    } catch (e) {
      if (isManual) addLog("⚠️ 读取配置失败，请重试。", "error");
    }
  };

  // 1. Load Settings on Mount (LocalStorage + Auto File)
  useEffect(() => {
    const loadSettings = async () => {
      let loadedConfig = INITIAL_CONFIG;
      let loadedSearch = INITIAL_SEARCH_CONFIG;
      let loadedCreds = INITIAL_CREDENTIALS;

      // A. Try LocalStorage first
      try {
        const savedConfig = localStorage.getItem(STORAGE_KEY_CONFIG);
        if (savedConfig) loadedConfig = { ...loadedConfig, ...JSON.parse(savedConfig) };

        const savedSearch = localStorage.getItem(STORAGE_KEY_SEARCH);
        if (savedSearch) loadedSearch = { ...loadedSearch, ...JSON.parse(savedSearch) };

        const savedCreds = localStorage.getItem(STORAGE_KEY_CREDS);
        if (savedCreds) loadedCreds = { ...loadedCreds, ...JSON.parse(savedCreds) };
      } catch (e) {}

      setConfig(loadedConfig);
      setSearchConfig(loadedSearch);
      setUserCredentials(loadedCreds);
      
      // B. Fetch Latest Creds
      await fetchCredentials();
    };

    loadSettings();
  }, []);

  // 2. Save Settings on Change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SEARCH, JSON.stringify(searchConfig));
  }, [searchConfig]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_CREDS, JSON.stringify(userCredentials));
  }, [userCredentials]);


  // --- Cache Helpers ---

  const getCacheKey = (type: 'rankings' | 'matches', identifier: string) => {
    return `${STORAGE_PREFIX_CACHE}${type}_${identifier}`;
  };

  const loadFromCache = <T,>(key: string): T | null => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed: DataCache<T> = JSON.parse(raw);
      if (Date.now() - parsed.timestamp < CACHE_DURATION_MS) {
         setLastCacheTime(new Date(parsed.timestamp).toLocaleString());
         return parsed.data;
      } else {
        localStorage.removeItem(key); // Expired
        return null;
      }
    } catch (e) {
      return null;
    }
  };

  const saveToCache = <T,>(key: string, data: T) => {
    try {
      const cacheObj: DataCache<T> = {
        data,
        timestamp: Date.now(),
        key
      };
      localStorage.setItem(key, JSON.stringify(cacheObj));
      setLastCacheTime(new Date().toLocaleString());
    } catch (e) {
      addLog("⚠️ 缓存失败: 本地存储空间可能已满", "error");
    }
  };

  const clearCurrentCache = () => {
    const keys = Object.keys(localStorage);
    keys.forEach(k => {
      if (k.startsWith(STORAGE_PREFIX_CACHE)) {
        localStorage.removeItem(k);
      }
    });
    setLastCacheTime('');
    addLog("🗑️ 缓存已清理，下次查询将从服务器获取最新数据。", "info");
  };


  // --- Helpers ---
  const addLog = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    setLogs(prev => [...prev, { timestamp: new Date().toLocaleTimeString(), message, type }]);
  };

  const updateConfig = (key: keyof ApiHeaderConfig, value: any) => setConfig(prev => ({ ...prev, [key]: value }));
  const updateSearchConfig = (key: keyof SearchConfig, value: any) => setSearchConfig(prev => ({ ...prev, [key]: value }));
  
  const handleError = (e: any) => {
    const msg = e.message || '未知错误';
    addLog(`❌ 出错了: ${msg}`, "error");
    setStatus(StepStatus.ERROR);
    
    // Check for Auth related keywords
    if (msg.includes('401') || msg.includes('Token') || msg.includes('登录') || msg.includes('鉴权')) {
        setHasAuthError(true);
        addLog("💡 提示: 可能是 Token 过期了，请点击左侧更新按钮。", "info");
    }
  };

  // --- Actions ---

  const handleFetchRankings = async () => {
    const errors: string[] = [];
    if (!config.token) errors.push("Token 未就绪");
    
    if (errors.length > 0) {
      addLog(`⛔ 无法开始: ${errors.join('，')}。请运行后台脚本。`, "error");
      setHasAuthError(true);
      return;
    }

    // CHECK CACHE FIRST
    const cacheKey = getCacheKey('rankings', `${searchConfig.province}_${searchConfig.city}_${searchConfig.birthYear}_${searchConfig.gameKeywords}_${searchConfig.groupKeywords}`);
    const cachedData = loadFromCache<PlayerRank[]>(cacheKey);

    setStatus(StepStatus.LOADING);
    setLogs([]);
    setRankings([]);
    setDashboardAnalysis(""); 
    setProgress(0);
    setView('DASHBOARD_RANKS');
    setLastCacheTime('');
    setHasAuthError(false);

    if (cachedData) {
      addLog("⚡ 发现有效的本地缓存，正在加载...", "success");
      setTimeout(() => {
        setRankings(cachedData);
        addLog(`✅ 加载完成！(数据来源: 本地缓存)`, "success");
        setStatus(StepStatus.COMPLETE);
      }, 500); 
      return;
    }

    try {
      addLog("🔎 正在扫描城市赛事列表...", "info");
      const games = await fetchGameList(
        config, // Service handles snTime automatically now
        searchConfig
      );
      
      if (games.length === 0) {
        addLog("❌ 未找到赛事，请检查Token是否有效，或更改城市/年份。", "error");
        setHasAuthError(true); 
        setStatus(StepStatus.ERROR);
        return;
      }
      setCachedGames(games); 
      addLog(`✅ 锁定 ${games.length} 个相关赛事! 开始抓取排名...`, "success");

      const ranks = await fetchAggregatedRankings(
        config,
        searchConfig,
        games,
        (msg, prog) => setProgress(prog)
      );

      setRankings(ranks);
      saveToCache(cacheKey, ranks);

      addLog(`🎉 大功告成！获取到 ${ranks.length} 条排名数据。`, "success");
      setStatus(StepStatus.COMPLETE);

    } catch (e: any) {
      handleError(e);
    }
  };

  const handleDirectPlayerSearch = async () => {
    const targetName = searchConfig.targetPlayerName?.trim();
    
    const errors: string[] = [];
    if (!targetName) errors.push("未输入小选手名字");
    if (!config.token) errors.push("Token 未就绪");
    
    if (errors.length > 0) {
      addLog(`⛔ 无法搜索: ${errors.join('，')}。`, "error");
      setHasAuthError(true);
      return;
    }

    const safePlayerName = targetName as string;

    // CHECK CACHE
    const cacheKey = getCacheKey('matches', `${safePlayerName}_${searchConfig.province}_${searchConfig.birthYear}`);
    const cachedData = loadFromCache<MatchScoreResult[]>(cacheKey);

    setStatus(StepStatus.LOADING);
    setLogs([]);
    setMatchHistory([]);
    setPlayerAnalysis("");
    setHasAuthError(false);
    
    setSelectedPlayer(safePlayerName);
    setView('PLAYER_HISTORY');
    setProgress(0);
    setLastCacheTime('');

    if (cachedData) {
      addLog("⚡ 发现小选手的历史缓存，正在加载...", "success");
      setTimeout(() => {
        setMatchHistory(cachedData);
        addLog(`✅ 加载完成！(数据来源: 本地缓存)`, "success");
        setStatus(StepStatus.COMPLETE);
      }, 500);
      return;
    }
    
    try {
       addLog(`🔍 启动全网搜人引擎: ${safePlayerName}`, "info");
       
       let games = cachedGames;
       if (games.length === 0) {
         addLog("正在获取赛事范围...", "info");
         games = await fetchGameList(config, searchConfig);
         setCachedGames(games);
       }
       
       addLog(`📚 正在 ${games.length} 场赛事中翻阅记录...`, "info");

       const matches = await fetchPlayerMatches(
        config,
        safePlayerName,
        games,
        (msg, prog) => setProgress(prog)
      );

      setMatchHistory(matches);
      saveToCache(cacheKey, matches);

      if (matches.length > 0) {
        addLog(`🎉 找到了！这位小选手打过 ${matches.length} 场比赛。`, "success");
        setStatus(StepStatus.COMPLETE);
      } else {
        addLog(`🤔 没找到记录。请确认名字是否正确，或调整年份/城市设置。`, "error");
        setStatus(StepStatus.COMPLETE);
      }

    } catch (e: any) {
      handleError(e);
    }
  };

  const handlePlayerClick = async (playerName: string) => {
    setSelectedPlayer(playerName);
    setView('PLAYER_HISTORY');
    setMatchHistory([]);
    setPlayerAnalysis("");
    setLastCacheTime('');
    setHasAuthError(false);
    
    const cacheKey = getCacheKey('matches', `${playerName}_${searchConfig.province}_${searchConfig.birthYear}`);
    const cachedData = loadFromCache<MatchScoreResult[]>(cacheKey);

    if (cachedData) {
      setMatchHistory(cachedData);
      setStatus(StepStatus.COMPLETE);
      return;
    }

    setStatus(StepStatus.LOADING);
    setProgress(0);
    addLog(`🚀 正在分析 [${playerName}] 的战绩详情...`, "info");

    try {
      if (cachedGames.length === 0) {
        const games = await fetchGameList(config, searchConfig);
        setCachedGames(games);
      }

      const matches = await fetchPlayerMatches(
        config,
        playerName,
        cachedGames,
        (msg, prog) => setProgress(prog)
      );

      setMatchHistory(matches);
      saveToCache(cacheKey, matches);

      addLog(`✅ 加载完成！`, "success");
      setStatus(StepStatus.COMPLETE);

    } catch (e: any) {
      handleError(e);
    }
  };

  const handleDemo = () => {
    addLog("🚧 加载演示数据模式...", "info");
    setRankings(getMockRanks());
    setCachedGames([{ id: 'mock', game_name: 'Mock Game' }]);
    setMatchHistory(getMockMatches("演示选手"));
    setStatus(StepStatus.COMPLETE);
    setSelectedPlayer("演示选手");
    setView('DASHBOARD_RANKS');
  };

  const exportExcel = (data: any[], filename: string) => {
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    XLSX.writeFile(wb, filename);
  };

  const handlePlayerAnalysis = async () => {
    if (matchHistory.length === 0) return;
    setIsAnalyzing(true);
    setPlayerAnalysis("AI 正在思考中... 🧠");
    const result = await analyzeData(matchHistory, `
      分析选手 "${selectedPlayer}" 的比赛数据。
      请用 Markdown 格式输出，包含以下部分（使用 ### 作为标题）：
      
      ### ⚡ 综合能力评估
      (分析胜率、得分能力和稳定性，给出积极的评价)
      
      ### 🛡️ 关键比赛复盘
      (指出遇到的最强对手是谁，以及比分最胶着的比赛)
      
      ### 💡 教练建议
      (基于数据给出一两个具体的改进建议或鼓励)
      
      请保持语气像一位和蔼可亲、充满激情的金牌青少年教练。
      重点数据请加粗显示。
    `);
    setPlayerAnalysis(result);
    setIsAnalyzing(false);
  };

  const handleDashboardAnalysis = async () => {
    if (rankings.length === 0) return;
    setIsAnalyzing(true);
    setDashboardAnalysis("AI 正在观察榜单... 🧐");
    const result = await analyzeData(rankings, `
      分析以下青少年羽毛球比赛的排名数据。
      请用 Markdown 格式输出，包含以下部分（使用 ### 作为标题）：

      ### 🏆 赛区统治力
      (分析哪些俱乐部或选手的表现最出色)
      
      ### 📊 竞争格局
      (分析积分分布，是否有断层或竞争非常激烈)
      
      ### 🌟 潜力新星
      (推荐几个值得关注的选手)
      
      请用简单易懂的中文回答。
    `);
    setDashboardAnalysis(result);
    setIsAnalyzing(false);
  };

  // --- Components for Markdown ---
  const MarkdownComponents = {
    h3: ({node, ...props}: any) => (
      <h3 className="text-lg font-black text-kid-primary mt-6 mb-3 flex items-center gap-2 border-b border-kid-primary/10 pb-2" {...props} />
    ),
    p: ({node, ...props}: any) => (
      <p className="text-slate-600 mb-3 leading-relaxed text-sm font-medium" {...props} />
    ),
    ul: ({node, ...props}: any) => (
      <ul className="space-y-2 mb-4" {...props} />
    ),
    li: ({node, children, ...props}: any) => (
      <li className="flex gap-2 items-start text-sm text-slate-700" {...props}>
        <span className="text-kid-secondary mt-1">•</span>
        <span>{children}</span>
      </li>
    ),
    strong: ({node, ...props}: any) => (
      <strong className="text-kid-orange font-black" {...props} />
    ),
  };

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-7xl mx-auto font-sans">
      <header className="mb-8 flex flex-col md:flex-row items-center justify-between gap-4 bg-white p-6 rounded-3xl shadow-md border-b-4 border-kid-blue/20">
        <div className="flex items-center gap-4">
          <div className="bg-yellow-400 p-3 rounded-2xl shadow-lg rotate-3">
            <Trophy className="w-8 h-8 text-white" />
          </div>
          <div>
             <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">
               羽毛球<span className="text-kid-primary">未来之星</span>数据站
             </h1>
             <p className="text-slate-500 font-medium mt-1">
               追踪成长每一步 • U{new Date().getFullYear() - searchConfig.birthYear} 组别专属
             </p>
          </div>
        </div>
        <div className="flex gap-2 text-sm font-bold text-slate-400 bg-slate-50 px-4 py-2 rounded-2xl">
           <span>📅 {new Date().getFullYear()}赛季</span>
           <span>📍 {searchConfig.city || searchConfig.province}</span>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* LEFT: Control Center (Config & Logs) */}
        <div className="lg:col-span-4 space-y-6">
          <ConfigPanel 
            config={config} 
            userCredentials={userCredentials}
            searchConfig={searchConfig}
            status={status}
            progress={progress}
            onConfigChange={updateConfig} 
            onSearchConfigChange={updateSearchConfig}
            onClearCache={clearCurrentCache}
            onScanRankings={handleFetchRankings}
            onDirectSearch={handleDirectPlayerSearch}
            onDemo={handleDemo}
            lastCacheTime={lastCacheTime}
            hasAuthError={hasAuthError}
            onRefreshCredentials={() => fetchCredentials(true)}
          />
          <LogViewer logs={logs} />
        </div>

        {/* RIGHT: Main Content Area */}
        <div className="lg:col-span-8 space-y-6">
          
          {/* VIEW 1: RANKINGS DASHBOARD */}
          {view === 'DASHBOARD_RANKS' && (
            <div className="space-y-6">
              {/* Dashboard Analysis Section */}
              {dashboardAnalysis && (
                <div className="bg-white border-2 border-kid-purple/30 rounded-[2rem] p-6 relative animate-fade-in shadow-xl overflow-hidden">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-kid-purple/5 rounded-full -mr-20 -mt-20 blur-3xl"></div>
                  
                  <button 
                    onClick={() => setDashboardAnalysis("")}
                    className="absolute top-4 right-4 text-slate-400 hover:text-kid-purple bg-slate-50 p-1.5 rounded-full transition-colors z-10"
                  >
                    <X className="w-5 h-5" />
                  </button>

                  <div className="flex items-center gap-3 mb-6 relative z-10">
                    <div className="bg-gradient-to-br from-kid-purple to-purple-600 p-2.5 rounded-xl text-white shadow-lg shadow-purple-200">
                       <Sparkles className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-lg font-black text-slate-800">AI 赛区观察</h3>
                      <p className="text-xs text-slate-500 font-bold">基于当前榜单的智能分析</p>
                    </div>
                  </div>

                  <div className="bg-slate-50/80 rounded-2xl p-6 border border-slate-100 relative z-10">
                    <ReactMarkdown components={MarkdownComponents}>
                      {dashboardAnalysis}
                    </ReactMarkdown>
                  </div>
                </div>
              )}

              <div className="bg-white rounded-[2rem] shadow-xl border border-slate-100 overflow-hidden flex flex-col h-[700px]">
                <div className="p-6 border-b border-slate-100 bg-gradient-to-r from-white to-slate-50 flex justify-between items-center">
                  <div>
                    <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                      <Medal className="w-6 h-6 text-kid-yellow" />
                      积分龙虎榜
                    </h3>
                    <p className="text-xs font-bold text-slate-400 mt-1 uppercase tracking-wider">
                      Leaderboard
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleDashboardAnalysis}
                      disabled={rankings.length === 0 || isAnalyzing}
                      className="text-sm font-bold bg-kid-purple/10 text-kid-purple hover:bg-kid-purple hover:text-white px-4 py-2 rounded-xl flex items-center gap-2 disabled:opacity-50 transition-all active:scale-95"
                    >
                      <Sparkles className="w-4 h-4" /> 
                      {isAnalyzing && !dashboardAnalysis ? "思考中..." : "AI 分析"}
                    </button>
                    <button 
                      onClick={() => exportExcel(rankings, 'Rankings.xlsx')}
                      disabled={rankings.length === 0}
                      className="text-sm font-bold bg-kid-green/10 text-kid-green hover:bg-kid-green hover:text-white px-4 py-2 rounded-xl flex items-center gap-2 disabled:opacity-50 transition-all active:scale-95"
                    >
                      <Download className="w-4 h-4" /> 导出
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-auto custom-scrollbar p-2">
                  <table className="w-full text-left text-sm border-separate border-spacing-y-2">
                    <thead className="text-slate-500 sticky top-0 z-10">
                      <tr>
                        <th className="px-4 py-2 font-bold text-xs uppercase bg-white">排名</th>
                        <th className="px-4 py-2 font-bold text-xs uppercase bg-white">小选手</th>
                        <th className="px-4 py-2 font-bold text-xs uppercase bg-white">俱乐部</th>
                        <th className="px-4 py-2 font-bold text-xs uppercase bg-white">积分</th>
                        <th className="px-4 py-2 font-bold text-xs uppercase bg-white">来源赛事</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rankings.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="p-12 text-center">
                            <div className="flex flex-col items-center justify-center opacity-40">
                              <Trophy className="w-16 h-16 text-slate-300 mb-4" />
                              <p className="font-bold text-lg text-slate-400">
                                {status === StepStatus.LOADING ? "正在努力扫描中..." : "暂无数据"}
                              </p>
                              <p className="text-sm text-slate-400 mt-1">
                                {status === StepStatus.LOADING ? "请稍候片刻" : "请在左侧点击开始扫描"}
                              </p>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        rankings.map((row, idx) => (
                          <tr key={idx} className="bg-slate-50 hover:bg-blue-50 hover:scale-[1.01] transition-transform duration-200 cursor-default rounded-xl group shadow-sm border border-slate-100">
                            <td className="px-4 py-4 rounded-l-xl">
                               <div className={`w-8 h-8 flex items-center justify-center rounded-full font-bold text-white shadow-sm ${
                                 idx === 0 ? 'bg-yellow-400' : 
                                 idx === 1 ? 'bg-slate-400' : 
                                 idx === 2 ? 'bg-orange-400' : 'bg-slate-200 text-slate-500'
                               }`}>
                                 {row.rank}
                               </div>
                            </td>
                            <td className="px-4 py-4">
                              <button 
                                onClick={() => handlePlayerClick(row.playerName)}
                                className="font-bold text-slate-800 text-base hover:text-kid-primary hover:underline flex items-center gap-2"
                              >
                                {row.playerName}
                                <span className="bg-white text-kid-primary border border-kid-primary text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                                  查看战绩
                                </span>
                              </button>
                            </td>
                            <td className="px-4 py-4 text-slate-500 font-medium">{row.club || '-'}</td>
                            <td className="px-4 py-4">
                              <span className="font-mono font-bold text-kid-primary text-lg">{row.score}</span>
                            </td>
                            <td className="px-4 py-4 rounded-r-xl">
                               <div className="text-xs font-bold text-slate-600 bg-white inline-block px-2 py-1 rounded border border-slate-200 mb-1">
                                 {row.groupName}
                               </div>
                               <div className="text-xs text-slate-400 truncate max-w-[150px]">{row.game_name}</div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* VIEW 2: PLAYER HISTORY */}
          {view === 'PLAYER_HISTORY' && (
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => setView('DASHBOARD_RANKS')}
                  className="p-3 rounded-full bg-white text-slate-400 hover:text-kid-primary hover:bg-blue-50 shadow-sm transition-all border border-slate-200"
                >
                  <ArrowLeft className="w-6 h-6" />
                </button>
                <div>
                   <h3 className="text-2xl font-black text-slate-800 flex items-center gap-2">
                     <span className="bg-kid-primary text-white px-3 py-1 rounded-xl shadow-md rotate-[-2deg] inline-block">
                       {selectedPlayer}
                     </span> 
                     的生涯档案
                   </h3>
                </div>
              </div>

              <div className="bg-white rounded-[2rem] shadow-xl border border-slate-100 flex flex-col h-[400px] overflow-hidden">
                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                  <div className="flex items-center gap-2">
                     <span className="bg-kid-blue w-2 h-2 rounded-full"></span>
                     <span className="font-bold text-slate-600">比赛记录: {matchHistory.length} 场</span>
                  </div>
                  <button 
                    onClick={() => exportExcel(matchHistory, `${selectedPlayer}_history.xlsx`)}
                    disabled={matchHistory.length === 0}
                    className="text-sm font-bold text-kid-green hover:bg-green-50 px-3 py-2 rounded-lg flex items-center gap-1 transition-colors"
                  >
                    <Download className="w-4 h-4" /> 下载表格
                  </button>
                </div>
                <div className="flex-1 overflow-auto custom-scrollbar p-2">
                  <table className="w-full text-left text-sm border-separate border-spacing-y-2">
                    <thead className="text-slate-400 text-xs uppercase bg-white sticky top-0 z-10">
                      <tr>
                        <th className="px-4 py-2 font-bold">时间 / 轮次</th>
                        <th className="px-4 py-2 font-bold">对手</th>
                        <th className="px-4 py-2 font-bold text-center">比分</th>
                        <th className="px-4 py-2 font-bold">赛事</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matchHistory.length === 0 && (
                         <tr>
                            <td colSpan={4} className="p-12 text-center text-slate-400 font-bold">
                               {status === StepStatus.LOADING ? "🔍 正在全网搜索..." : "📭 暂无记录"}
                            </td>
                         </tr>
                      )}
                      {matchHistory.map((m, idx) => {
                        const isPlayerA = m.playerA.includes(selectedPlayer || '');
                        const opponent = isPlayerA ? m.playerB : m.playerA;
                        
                        // WIN/LOSS Logic
                        let isWin = false;
                        let isDraw = false;
                        let scoreParsed = false;
                        
                        if (m.score && m.score.includes(':')) {
                          const parts = m.score.split(':').map(p => parseInt(p.replace(/[^0-9]/g, '')));
                          if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                             scoreParsed = true;
                             const scoreA = parts[0];
                             const scoreB = parts[1];
                             
                             if (isPlayerA) {
                               isWin = scoreA > scoreB;
                             } else {
                               isWin = scoreB > scoreA;
                             }
                             if (scoreA === scoreB) isDraw = true;
                          }
                        }

                        return (
                          <tr key={idx} className="bg-slate-50 hover:bg-white hover:shadow-md transition-all rounded-xl border border-transparent hover:border-slate-100">
                            <td className="px-4 py-3 rounded-l-xl">
                              <div className="font-bold text-slate-700">{m.matchTime || '-'}</div>
                              <div className="text-xs font-medium text-slate-400 bg-white border border-slate-200 px-2 py-0.5 rounded inline-block mt-1">{m.round}</div>
                            </td>
                            <td className="px-4 py-3 font-bold text-slate-600">{opponent}</td>
                            <td className="px-4 py-3 text-center">
                              <div className="flex flex-col items-center">
                                <span className="font-mono font-black text-lg text-slate-800 bg-white px-3 py-1 rounded-lg border-2 border-slate-100 shadow-inner">
                                  {m.score}
                                </span>
                                {scoreParsed && !isDraw && (
                                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full mt-1 flex items-center gap-1 ${isWin ? 'bg-green-100 text-green-600' : 'bg-slate-200 text-slate-500'}`}>
                                     {isWin ? <Smile className="w-3 h-3"/> : <Frown className="w-3 h-3"/>}
                                     {isWin ? '胜利' : '惜败'}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 rounded-r-xl">
                              <div className="text-xs font-bold text-kid-primary truncate max-w-[150px]">{m.game_name}</div>
                              <div className="text-[10px] text-slate-400 mt-0.5">{m.groupName}</div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* AI Analysis for Player */}
              <div className="bg-white rounded-[2rem] shadow-xl border-2 border-kid-orange/20 p-6 relative overflow-hidden animate-fade-in">
                <div className="absolute top-0 right-0 w-64 h-64 bg-kid-orange/5 rounded-full -mr-20 -mt-20 blur-3xl pointer-events-none"></div>
                
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4 relative z-10">
                  <div className="flex items-center gap-3">
                    <div className="bg-gradient-to-br from-kid-orange to-orange-500 p-2.5 rounded-xl text-white shadow-lg shadow-orange-200">
                       <BarChart2 className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-slate-800">AI 战术分析室</h3>
                      <p className="text-xs text-slate-500 font-bold">基于历史数据生成的智能报告</p>
                    </div>
                  </div>
                  <button
                    onClick={handlePlayerAnalysis}
                    disabled={matchHistory.length === 0 || isAnalyzing}
                    className="bg-kid-orange hover:bg-orange-600 text-white px-5 py-2 rounded-xl font-bold shadow-lg shadow-orange-200 hover:shadow-orange-300 transition-all flex items-center gap-2 active:scale-95 disabled:opacity-50 disabled:shadow-none"
                  >
                    <Sparkles className="w-4 h-4" />
                    {isAnalyzing && !playerAnalysis ? "思考中..." : "生成教练报告"}
                  </button>
                </div>

                <div className="bg-slate-50/80 rounded-2xl p-6 border border-slate-100 min-h-[150px] relative z-10">
                  {playerAnalysis ? (
                    <ReactMarkdown components={MarkdownComponents}>
                      {playerAnalysis}
                    </ReactMarkdown>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400 py-8">
                       <Lightbulb className="w-10 h-10 mb-3 opacity-50" />
                       <p className="text-sm font-medium">点击右上角按钮，让 AI 教练为您分析小选手的表现</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default App;