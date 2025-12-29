import React, { useState, useEffect, useMemo } from 'react';
import { ApiHeaderConfig, SearchConfig, StepStatus, MatchScoreResult, PlayerRank, LogEntry, AppView, GameBasicInfo, UserCredentials, DataCache } from './types';
import ConfigPanel from './components/ConfigPanel';
import LogViewer from './components/LogViewer';
import { fetchGameList, fetchAggregatedRankings, fetchPlayerMatches, getMockRanks, getMockMatches } from './services/huaTiHuiService';
import { analyzeData } from './services/geminiService';
import { Download, ArrowLeft, Trophy, BarChart2, Sparkles, X, Medal, Smile, Frown, Lightbulb, Database, Zap, PieChart, Cloud } from 'lucide-react';
import * as XLSX from 'xlsx';
import ReactMarkdown from 'react-markdown';

// --- CONSTANTS FOR PERSISTENCE ---
const STORAGE_KEY_CONFIG = 'hth_config_v1';
const STORAGE_KEY_SEARCH = 'hth_search_v2'; // Bumped version for new schema
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
  province: "广东省",
  city: "广州市",
  gameKeywords: "", 
  uKeywords: 'U8', // Default U-series
  levelKeywords: '', // Default Level
  itemKeywords: '男单',
  targetPlayerName: '超级丹'
};

// --- Custom Icons for Background ---
const Shuttlecock = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 100 100" className={className} fill="currentColor">
     {/* Cork */}
     <path d="M35,80 Q50,95 65,80 L65,75 L35,75 Z" />
     {/* Feathers/Skirt */}
     <path d="M36,74 L20,20 Q50,5 80,20 L64,74 Z" opacity="0.6" />
     <path d="M42,74 L38,20" stroke="currentColor" strokeWidth="2" />
     <path d="M58,74 L62,20" stroke="currentColor" strokeWidth="2" />
     <line x1="28" y1="35" x2="72" y2="35" stroke="currentColor" strokeWidth="1" />
     <line x1="32" y1="55" x2="68" y2="55" stroke="currentColor" strokeWidth="1" />
  </svg>
);

const Racket = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 100 100" className={className} fill="none" stroke="currentColor" strokeWidth="4">
    {/* Head */}
    <ellipse cx="50" cy="35" rx="30" ry="32" />
    {/* Strings */}
    <line x1="35" y1="10" x2="35" y2="60" strokeWidth="1" opacity="0.3" />
    <line x1="50" y1="5" x2="50" y2="65" strokeWidth="1" opacity="0.3" />
    <line x1="65" y1="10" x2="65" y2="60" strokeWidth="1" opacity="0.3" />
    <line x1="25" y1="25" x2="75" y2="25" strokeWidth="1" opacity="0.3" />
    <line x1="22" y1="40" x2="78" y2="40" strokeWidth="1" opacity="0.3" />
    <line x1="30" y1="55" x2="70" y2="55" strokeWidth="1" opacity="0.3" />
    {/* Shaft */}
    <line x1="50" y1="67" x2="50" y2="100" strokeWidth="6" strokeLinecap="round" />
  </svg>
);


export const App: React.FC = () => {
  // State
  const [config, setConfig] = useState<ApiHeaderConfig>(INITIAL_CONFIG);
  const [userCredentials, setUserCredentials] = useState<UserCredentials>(INITIAL_CREDENTIALS);
  const [searchConfig, setSearchConfig] = useState<SearchConfig>(INITIAL_SEARCH_CONFIG);
  
  const [view, setView] = useState<AppView>('PLAYER_HISTORY');
  const [status, setStatus] = useState<StepStatus>(StepStatus.IDLE);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [progress, setProgress] = useState(0);
  const [hasAuthError, setHasAuthError] = useState(false);

  // Data Cache
  const [rankings, setRankings] = useState<PlayerRank[]>([]);
  // Fix: Added 'API' to the allowed types to match service return type
  const [rankingSource, setRankingSource] = useState<{type: 'CACHE' | 'LIVE' | 'API', time?: string} | null>(null);

  const [selectedPlayer, setSelectedPlayer] = useState<string | null>('超级丹');
  const [matchHistory, setMatchHistory] = useState<MatchScoreResult[]>([]);
  const [lastCacheTime, setLastCacheTime] = useState<string>('');

  // Analysis
  const [playerAnalysis, setPlayerAnalysis] = useState<string>("");
  const [dashboardAnalysis, setDashboardAnalysis] = useState<string>("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // --- Statistics Memo ---
  const playerStats = useMemo(() => {
    if (!matchHistory.length || !selectedPlayer) return { wins: 0, losses: 0, draws: 0, rate: 0 };
    
    let wins = 0;
    let losses = 0;
    let draws = 0;
    let validGames = 0; // Games where score could be parsed

    matchHistory.forEach(m => {
        const isPlayerA = m.playerA.includes(selectedPlayer);
        
        if (m.score && m.score.includes(':')) {
            // Remove non-numeric characters except the separator
            const parts = m.score.split(':').map(p => parseInt(p.replace(/[^0-9]/g, ''), 10));
            if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                validGames++;
                const scoreA = parts[0];
                const scoreB = parts[1];
                
                if (scoreA === scoreB) {
                    draws++;
                } else if (isPlayerA) {
                    if (scoreA > scoreB) wins++;
                    else losses++;
                } else {
                    // Player B
                    if (scoreB > scoreA) wins++;
                    else losses++;
                }
            }
        }
    });

    // Calculate Rate
    const denominator = validGames > 0 ? validGames : 1;
    const rate = Math.round((wins / denominator) * 100);

    return { wins, losses, draws, rate, validGames };
  }, [matchHistory, selectedPlayer]);

  // --- Persistence Effects ---
  
  // --- Helpers ---
  const addLog = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    // 🔍 LOG LEVEL CONTROL
    const logLevel = (process.env.LOG_LEVEL as string) || 'development';
    
    let finalMessage: string | null = message;

    if (logLevel === 'production') {
      if (message.includes('准备下载服务端数据文件')) {
        finalMessage = '同步服务端数据'; 
      }
      else if (message.includes('下载中:')) {
        finalMessage = null; 
      }
      else if (message.includes('数据解析成功')) {
        finalMessage = null;
      }
      else if (message.includes('正在初始化 Gemini AI 请求')) {
        finalMessage = '正在初始化 AI 请求.';
      }
      else if (message.includes('API Key 状态')) {
        finalMessage = 'Key 状态: 已加载';
      }
      else if (message.includes('调用模型')) {
        finalMessage = '调用 ai 模型（proxy）';
      }
      else if (message.includes('[网络搜索] 正在检索')) {
        const match = message.match(/\((\d+)\/(\d+)\)/);
        if (match) {
          const current = parseInt(match[1]);
          const total = parseInt(match[2]);
          const percent = Math.floor((current / total) * 100);
          finalMessage = `正在检索进度: ${percent}%`;
        } else {
          finalMessage = '正在检索数据...';
        }
      }
      else if (message.includes('数据负载') || message.includes('请求已发送') || message.includes('耗时') || message.includes('解析 JSON')) {
         finalMessage = null;
      }
      else if (message.includes('分析成功')) {
         finalMessage = 'AI 分析完成';
      }
    }

    if (finalMessage) {
      setLogs(prev => [...prev, { timestamp: new Date().toLocaleTimeString(), message: finalMessage!, type }]);
    }
  };

  const fetchCredentials = async (isManual = false) => {
    try {
      const res = await fetch(`/auth_config.json?t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const autoData = await res.json();
        
        if (autoData.status === 'initializing') {
            if (isManual) addLog("⏳ 后台脚本正在启动初始化，请稍候再试...", "info");
            return;
        }

        if (autoData.token) {
            setConfig(prev => ({
              ...prev,
              token: autoData.token,
              sn: autoData.sn || prev.sn,
              snTime: Date.now()
            }));
            setUserCredentials(prev => ({
              ...prev,
              isLoggedIn: true,
              username: autoData.username || prev.username || 'Auto-User'
            }));
            
            setHasAuthError(false);
            
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

  // 1. Load Settings on Mount
  useEffect(() => {
    const loadSettings = async () => {
      let loadedConfig = INITIAL_CONFIG;
      let loadedSearch = INITIAL_SEARCH_CONFIG;
      let loadedCreds = INITIAL_CREDENTIALS;

      try {
        const savedConfig = localStorage.getItem(STORAGE_KEY_CONFIG);
        if (savedConfig) loadedConfig = { ...loadedConfig, ...JSON.parse(savedConfig) };

        const savedSearch = localStorage.getItem(STORAGE_KEY_SEARCH);
        if (savedSearch) {
             const parsed = JSON.parse(savedSearch);
             loadedSearch = { 
                 ...loadedSearch, 
                 ...parsed,
                 uKeywords: parsed.uKeywords !== undefined ? parsed.uKeywords : 'U8',
                 levelKeywords: parsed.levelKeywords !== undefined ? parsed.levelKeywords : ''
             };
        }

        const savedCreds = localStorage.getItem(STORAGE_KEY_CREDS);
        if (savedCreds) loadedCreds = { ...loadedCreds, ...JSON.parse(savedCreds) };
      } catch (e) {}

      setConfig(loadedConfig);
      setSearchConfig(loadedSearch);
      setUserCredentials(loadedCreds);
      
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

  const saveToCache = <T extends any[]>(key: string, data: T) => {
    try {
      if (data.length === 0) {
        localStorage.removeItem(key); 
        return; 
      }

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
    setRankingSource(null);
    addLog("🗑️ 缓存已清理，下次查询将从服务器获取最新数据。", "info");
  };

  const updateConfig = (key: keyof ApiHeaderConfig, value: any) => setConfig(prev => ({ ...prev, [key]: value }));
  const updateSearchConfig = (key: keyof SearchConfig, value: any) => setSearchConfig(prev => ({ ...prev, [key]: value }));
  
  const handleError = (e: any) => {
    const msg = e.message || '未知错误';
    addLog(`❌ 出错了: ${msg}`, "error");
    setStatus(StepStatus.ERROR);
    
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

    const cacheKey = getCacheKey('rankings', `${searchConfig.province}_${searchConfig.city}_${searchConfig.uKeywords}_${searchConfig.levelKeywords}_${searchConfig.gameKeywords}_${searchConfig.itemKeywords}_${searchConfig.targetPlayerName}`);
    const localCachedData = loadFromCache<PlayerRank[]>(cacheKey);

    setStatus(StepStatus.LOADING);
    setLogs([]);
    setRankings([]);
    setRankingSource(null);
    setDashboardAnalysis(""); 
    setProgress(0);
    setView('DASHBOARD_RANKS');
    setLastCacheTime('');
    setHasAuthError(false);

    if (localCachedData && localCachedData.length > 0) {
      addLog("⚡ 发现有效的本地浏览器缓存，正在加载...", "success");
      setTimeout(() => {
        setRankings(localCachedData);
        setRankingSource({ type: 'CACHE', time: '浏览器本地缓存' });
        addLog(`✅ 加载完成！(数据来源: 本地缓存)`, "success");
        setStatus(StepStatus.COMPLETE);
      }, 500); 
      return;
    } else if (localCachedData && localCachedData.length === 0) {
        addLog("🧹 本地缓存结果为空，正在重新向服务器确认...", "info");
        localStorage.removeItem(cacheKey); 
    }

    try {
      addLog("⏳ 开始检索...", "info");
      
      const result = await fetchAggregatedRankings(
        config,
        searchConfig,
        (msg, prog) => {
           setProgress(prog);
           if (prog === 5 || prog === 15 || prog === 100 || msg.includes('网络搜索') || msg.includes('解析') || (msg.includes('下载') && prog % 5 === 0)) {
              addLog(msg, "info"); 
           }
        }
      );

      setRankings(result.data);
      setRankingSource({ 
          type: result.source, 
          time: result.updatedAt 
      });

      saveToCache(cacheKey, result.data);

      if (result.data.length > 0) {
        addLog(`🎉 大功告成！获取到 ${result.data.length} 条排名数据。`, "success");
      } else {
        addLog(`📭 本次查询未找到数据 (组别不匹配 或 赛事未录入)。`, "info");
      }
      
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

    const genderKey = searchConfig.playerGender || 'ALL';
    // [Updated Cache Key] Include City to prevent wrong location cache hits
    const cacheKey = getCacheKey('matches', `${safePlayerName}_${searchConfig.province}_${searchConfig.city}_${genderKey}`);
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

    if (cachedData && cachedData.length > 0) {
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
       
       const matches = await fetchPlayerMatches(
        config,
        safePlayerName,
        searchConfig,
        (msg, prog) => {
            setProgress(prog);
            if (prog === 5 || prog === 100 || msg.includes('网络搜索') || msg.includes('解析') || (msg.includes('下载') && prog % 5 === 0)) {
                addLog(msg, "info");
            }
        }
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
    
    const genderKey = searchConfig.playerGender || 'ALL';
    // [Updated Cache Key] Include City
    const cacheKey = getCacheKey('matches', `${playerName}_${searchConfig.province}_${searchConfig.city}_${genderKey}`);
    const cachedData = loadFromCache<MatchScoreResult[]>(cacheKey);

    if (cachedData && cachedData.length > 0) {
      setMatchHistory(cachedData);
      setStatus(StepStatus.COMPLETE);
      return;
    }

    setStatus(StepStatus.LOADING);
    setProgress(0);
    addLog(`🚀 正在分析 [${playerName}] 的战绩详情...`, "info");

    try {
      const matches = await fetchPlayerMatches(
        config,
        playerName,
        searchConfig,
        (msg, prog) => {
             setProgress(prog);
             if (prog === 5 || prog === 100 || msg.includes('网络搜索') || msg.includes('解析') || (msg.includes('下载') && prog % 5 === 0)) {
                addLog(msg, "info");
             }
        }
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
    `, (msg, type) => {
        addLog(`[AI] ${msg}`, type);
    });

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
    `, (msg, type) => {
        addLog(`[AI] ${msg}`, type);
    });

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
    <>
      {/* Background Decorative Elements */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
          <div className="absolute top-10 left-10 text-kid-blue/10 animate-float-slow opacity-20">
             <Shuttlecock className="w-32 h-32" />
          </div>
          <div className="absolute bottom-20 right-10 text-kid-orange/10 animate-float-reverse opacity-20">
             <Racket className="w-40 h-40" />
          </div>
          <div className="absolute top-1/2 left-1/4 text-kid-green/10 animate-float-slow opacity-15">
             <Trophy className="w-24 h-24" />
          </div>
          <div className="absolute top-20 right-1/4 text-kid-purple/10 animate-spin-slow opacity-15">
             <Medal className="w-16 h-16" />
          </div>
          <div className="absolute bottom-1/4 left-10 text-kid-yellow/20 animate-float-reverse opacity-20">
             <Shuttlecock className="w-20 h-20 transform rotate-45" />
          </div>
      </div>

      <div className="relative z-10 min-h-screen p-4 md:p-8 max-w-7xl mx-auto font-sans">
        <header className="mb-8 flex flex-col md:flex-row items-center justify-between gap-4 bg-white/90 backdrop-blur-sm p-6 rounded-3xl shadow-md border-b-4 border-kid-blue/20">
          <div className="flex items-center gap-4">
            <div className="bg-yellow-400 p-3 rounded-2xl shadow-lg rotate-3 group hover:rotate-12 transition-transform">
              <Trophy className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">
                羽毛球<span className="text-kid-primary">未来之星</span>数据站
              </h1>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-base font-bold bg-gradient-to-r from-kid-primary to-kid-accent bg-clip-text text-transparent">
                  挥洒汗水，快乐成长！
                </span>
                <Shuttlecock className="w-6 h-6 text-kid-primary transform rotate-12" />
              </div>
            </div>
          </div>
          <div className="flex gap-2 text-sm font-bold text-slate-400 bg-slate-50/80 px-4 py-2 rounded-2xl">
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
                
                <div className="bg-white/95 backdrop-blur rounded-[2rem] shadow-xl border border-slate-100 overflow-hidden flex flex-col h-[400px]">
                  <div className="p-6 border-b border-slate-100 bg-gradient-to-r from-white to-slate-50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                      <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                        <Medal className="w-6 h-6 text-kid-yellow" />
                        赛事龙虎榜
                      </h3>
                      
                      {/* Data Source Badge */}
                      <div className="flex items-center gap-2 mt-1">
                        {rankingSource ? (
                          <div className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 border ${
                              rankingSource.type === 'CACHE' 
                                ? 'bg-green-50 text-green-600 border-green-200' 
                                : rankingSource.type === 'API'
                                    ? 'bg-purple-50 text-purple-600 border-purple-200'
                                    : 'bg-blue-50 text-blue-600 border-blue-200'
                          }`}>
                            {rankingSource.type === 'CACHE' ? <Database className="w-3 h-3"/> : rankingSource.type === 'API' ? <Cloud className="w-3 h-3"/> : <Zap className="w-3 h-3"/>}
                            {rankingSource.type === 'CACHE' 
                                ? `已缓存 (${rankingSource.time})` 
                                : rankingSource.type === 'API'
                                    ? '云端数据'
                                    : '实时抓取'
                            }
                          </div>
                        ) : (
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Leaderboard</p>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 w-full md:w-auto">
                      <button 
                        onClick={() => exportExcel(rankings, 'Rankings.xlsx')}
                        disabled={rankings.length === 0}
                        className="flex-1 md:flex-none text-sm font-bold bg-kid-green/10 text-kid-green hover:bg-kid-green hover:text-white px-4 py-2 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 transition-all active:scale-95"
                      >
                        <Download className="w-4 h-4" /> 导出
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 overflow-auto custom-scrollbar p-2">
                    <table className="w-full text-left text-sm border-separate border-spacing-y-2">
                      <thead className="text-slate-500 sticky top-0 z-10">
                        <tr>
                          <th className="px-4 py-2 font-bold text-xs uppercase bg-white/95 w-16">排名</th>
                          <th className="px-4 py-2 font-bold text-xs uppercase bg-white/95">小选手</th>
                          <th className="px-4 py-2 font-bold text-xs uppercase bg-white/95 hidden md:table-cell">俱乐部</th>
                          <th className="px-4 py-2 font-bold text-xs uppercase bg-white/95">积分</th>
                          <th className="px-4 py-2 font-bold text-xs uppercase bg-white/95 hidden md:table-cell">赛事</th>
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
                            <tr key={idx} className="bg-slate-50/80 hover:bg-blue-50 hover:scale-[1.01] transition-transform duration-200 cursor-default rounded-xl group shadow-sm border border-slate-100">
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
                                <div className="flex flex-col">
                                  <button 
                                    onClick={() => handlePlayerClick(row.playerName)}
                                    className="font-bold text-slate-800 text-base hover:text-kid-primary hover:underline flex items-center gap-2 text-left"
                                  >
                                    {row.playerName}
                                  </button>
                                  {/* Mobile Only: Club Name */}
                                  <span className="text-xs text-slate-400 font-medium md:hidden mt-0.5 truncate max-w-[120px]">
                                    {row.club || '-'}
                                  </span>
                                </div>
                              </td>
                              {/* Desktop Only: Club Name */}
                              <td className="px-4 py-4 text-slate-500 font-medium hidden md:table-cell">{row.club || '-'}</td>
                              <td className="px-4 py-4">
                                <span className="font-mono font-bold text-kid-primary text-lg">{row.score}</span>
                              </td>
                              <td className="px-4 py-4 rounded-r-xl">
                                <div className="flex flex-col items-start">
                                    <div className="text-xs font-bold text-kid-primary truncate max-w-[150px]">
                                      {row.game_name}
                                    </div>
                                    <div className="text-[10px] text-slate-400 mt-0.5">
                                      {row.groupName}
                                    </div>
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* AI Analysis for Rankings (New Location & Style) */}
                <div className="bg-white/95 backdrop-blur rounded-[2rem] shadow-xl border-2 border-kid-purple/20 p-6 relative overflow-hidden animate-fade-in">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-kid-purple/5 rounded-full -mr-20 -mt-20 blur-3xl pointer-events-none"></div>
                  
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4 relative z-10">
                    <div className="flex items-center gap-3">
                      <div className="bg-gradient-to-br from-kid-purple to-purple-600 p-2.5 rounded-xl text-white shadow-lg shadow-purple-200">
                        <Sparkles className="w-6 h-6" />
                      </div>
                      <div>
                        <h3 className="text-xl font-black text-slate-800">AI 榜单分析</h3>
                        <p className="text-xs text-slate-500 font-bold">基于当前榜单的智能分析</p>
                      </div>
                    </div>
                    <button
                      onClick={handleDashboardAnalysis}
                      disabled={rankings.length === 0 || isAnalyzing}
                      className="bg-kid-purple hover:bg-purple-600 text-white px-5 py-2 rounded-xl font-bold shadow-lg shadow-purple-200 hover:shadow-purple-300 transition-all flex items-center gap-2 active:scale-95 disabled:opacity-50 disabled:shadow-none"
                    >
                      <Sparkles className="w-4 h-4" />
                      {isAnalyzing && !dashboardAnalysis ? "思考中..." : "生成赛区报告"}
                    </button>
                  </div>

                  <div className="bg-slate-50/80 rounded-2xl p-6 border border-slate-100 min-h-[150px] relative z-10">
                    {dashboardAnalysis ? (
                      <ReactMarkdown components={MarkdownComponents}>
                        {dashboardAnalysis}
                      </ReactMarkdown>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full text-slate-400 py-8">
                        <Lightbulb className="w-10 h-10 mb-3 opacity-50" />
                        <p className="text-sm font-medium">点击右上角按钮，让 AI 深度分析当前赛事的竞争格局</p>
                      </div>
                    )}
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
                      <span className="hidden md:inline">的生涯档案</span>
                    </h3>
                  </div>
                </div>

                <div className="bg-white/95 backdrop-blur rounded-[2rem] shadow-xl border border-slate-100 flex flex-col h-[400px] overflow-hidden">
                  <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center bg-slate-50/50 gap-4">
                    {/* STATS HEADER */}
                    <div className="flex flex-col gap-2">
                         <div className="flex items-center gap-2">
                            <span className="bg-kid-blue w-2 h-2 rounded-full"></span>
                            <span className="font-bold text-slate-600 text-sm md:text-base">比赛记录: {matchHistory.length} 场</span>
                         </div>
                         {/* WIN/LOSS STATS */}
                         {matchHistory.length > 0 && (
                             <div className="flex items-center gap-3 text-xs md:text-sm font-bold bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
                                <div className="flex items-center gap-1 text-green-600">
                                   <Smile className="w-3.5 h-3.5" />
                                   <span>胜 {playerStats.wins}</span>
                                </div>
                                <div className="w-px h-3 bg-slate-300"></div>
                                <div className="flex items-center gap-1 text-red-500">
                                   <Frown className="w-3.5 h-3.5" />
                                   <span>输 {playerStats.losses}</span>
                                </div>
                                {playerStats.draws > 0 && (
                                    <>
                                     <div className="w-px h-3 bg-slate-300"></div>
                                     <span className="text-slate-400">平 {playerStats.draws}</span>
                                    </>
                                )}
                                <div className="w-px h-3 bg-slate-300"></div>
                                <div className="flex items-center gap-1 text-kid-primary">
                                   <PieChart className="w-3.5 h-3.5" />
                                   <span>胜率 {playerStats.rate}%</span>
                                </div>
                             </div>
                         )}
                    </div>

                    <button 
                      onClick={() => exportExcel(matchHistory, `${selectedPlayer}_history.xlsx`)}
                      disabled={matchHistory.length === 0}
                      className="text-sm font-bold text-kid-green hover:bg-green-50 px-3 py-2 rounded-lg flex items-center gap-1 transition-colors self-end md:self-auto"
                    >
                      <Download className="w-4 h-4" /> <span className="hidden md:inline">下载表格</span>
                    </button>
                  </div>
                  <div className="flex-1 overflow-auto custom-scrollbar p-2">
                    <table className="w-full text-left text-sm border-separate border-spacing-y-2">
                      <thead className="text-slate-400 text-xs uppercase bg-white/95 sticky top-0 z-10">
                        <tr>
                          <th className="px-4 py-2 font-bold">时间 / 轮次</th>
                          <th className="px-4 py-2 font-bold">对手</th>
                          <th className="px-4 py-2 font-bold text-center">比分</th>
                          <th className="px-4 py-2 font-bold hidden md:table-cell">赛事</th>
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
                            <tr key={idx} className="bg-slate-50/80 hover:bg-white hover:shadow-md transition-all rounded-xl border border-transparent hover:border-slate-100">
                              <td className="px-4 py-3 rounded-l-xl">
                                <div className="font-bold text-slate-700">{m.matchTime || '-'}</div>
                                <div className="text-xs font-medium text-slate-400 bg-white border border-slate-200 px-2 py-0.5 rounded inline-block mt-1">{m.round}</div>
                              </td>
                              <td className="px-4 py-3 font-bold text-slate-600">
                                  {opponent}
                                  {/* Mobile: Show game name here if hidden */}
                                  <div className="md:hidden text-[10px] text-slate-300 mt-1 truncate max-w-[80px]">{m.game_name}</div>
                              </td>
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
                              <td className="px-4 py-3 rounded-r-xl hidden md:table-cell">
                                <div className="text-xs font-bold text-kid-primary truncate max-w-[150px]">{m.game_name}</div>
                                <div className="text-[10px] text-slate-400 mt-0.5">{m.fullName || m.groupName}</div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* AI Analysis for Player */}
                <div className="bg-white/95 backdrop-blur rounded-[2rem] shadow-xl border-2 border-kid-orange/20 p-6 relative overflow-hidden animate-fade-in">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-kid-orange/5 rounded-full -mr-20 -mt-20 blur-3xl pointer-events-none"></div>
                  
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4 relative z-10">
                    <div className="flex items-center gap-3">
                      <div className="bg-gradient-to-br from-kid-orange to-orange-500 p-2.5 rounded-xl text-white shadow-lg shadow-orange-200">
                        <BarChart2 className="w-6 h-6" />
                      </div>
                      <div>
                        <h3 className="text-xl font-black text-slate-800">AI 过往比赛分析</h3>
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
    </>
  );
};