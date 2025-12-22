import React, { useEffect, useState } from 'react';
import { ApiHeaderConfig, SearchConfig, StepStatus, UserCredentials } from '../types';
import { Calendar, Search, ChevronDown, ChevronUp, Trophy, UserSearch, RefreshCw, Trash2, CheckCircle, AlertTriangle, Terminal, Clock, RotateCcw } from 'lucide-react';
import { generateDefaultKeywords } from '../services/huaTiHuiService';

interface Props {
  config: ApiHeaderConfig;
  userCredentials: UserCredentials;
  searchConfig: SearchConfig;
  status: StepStatus;
  progress: number;
  onConfigChange: (key: keyof ApiHeaderConfig, value: any) => void;
  onSearchConfigChange: (key: keyof SearchConfig, value: any) => void;
  onClearCache: () => void;
  // Actions passed from parent
  onScanRankings: () => void;
  onDirectSearch: () => void;
  onDemo: () => void;
  lastCacheTime?: string;
  hasAuthError?: boolean;
  onRefreshCredentials?: () => void;
}

const ConfigPanel: React.FC<Props> = ({ 
  config, userCredentials, searchConfig, status, progress,
  onSearchConfigChange, onClearCache,
  onScanRankings, onDirectSearch, onDemo, lastCacheTime,
  hasAuthError, onRefreshCredentials
}) => {
  
  const [activeTab, setActiveTab] = useState<'rank' | 'player'>('rank');
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  // Auto-update keywords when birth year changes
  useEffect(() => {
    const keywords = generateDefaultKeywords(searchConfig.birthYear);
    onSearchConfigChange('groupKeywords', keywords);
  }, [searchConfig.birthYear]);

  const currentAge = new Date().getFullYear() - searchConfig.birthYear;

  return (
    <div className="bg-white rounded-[2rem] shadow-xl border-2 border-slate-100 overflow-hidden relative">
      {/* 顶部装饰 */}
      <div className="h-3 bg-gradient-to-r from-kid-primary via-kid-purple to-kid-accent"></div>

      {/* 1. 模式选择 Tabs */}
      <div className="flex border-b border-slate-100">
        <button
          onClick={() => setActiveTab('rank')}
          className={`flex-1 py-4 text-sm font-bold flex items-center justify-center gap-2 transition-colors relative ${
            activeTab === 'rank' ? 'text-kid-primary bg-white' : 'text-slate-400 bg-slate-50 hover:bg-slate-100'
          }`}
        >
          <Trophy className={`w-4 h-4 ${activeTab === 'rank' ? 'text-kid-yellow' : ''}`} />
          查排行榜
          {activeTab === 'rank' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-kid-primary mx-8 rounded-t-full"></div>}
        </button>
        <button
          onClick={() => setActiveTab('player')}
          className={`flex-1 py-4 text-sm font-bold flex items-center justify-center gap-2 transition-colors relative ${
            activeTab === 'player' ? 'text-kid-orange bg-white' : 'text-slate-400 bg-slate-50 hover:bg-slate-100'
          }`}
        >
          <UserSearch className={`w-4 h-4 ${activeTab === 'player' ? 'text-kid-orange' : ''}`} />
          查小选手
          {activeTab === 'player' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-kid-orange mx-8 rounded-t-full"></div>}
        </button>
      </div>

      {/* 2. 动态内容区域 */}
      <div className="p-5 space-y-5">
        
        {/* PART A: 输入参数 (Inputs) */}
        {activeTab === 'rank' && (
          <div className="bg-blue-50/50 p-3 rounded-2xl border border-blue-100 animate-fade-in">
             <label className="block text-xs font-bold text-slate-500 mb-1 ml-1">出生年份</label>
             <div className="flex items-center gap-2">
               <div className="relative flex-1">
                 <Calendar className="absolute left-3 top-2.5 w-4 h-4 text-kid-blue" />
                 <input
                   type="number"
                   value={searchConfig.birthYear}
                   onChange={(e) => onSearchConfigChange('birthYear', Number(e.target.value))}
                   className="w-full pl-9 px-3 py-2 bg-white border border-blue-200 rounded-xl text-sm focus:outline-none focus:border-kid-blue font-bold text-slate-700"
                 />
               </div>
               <span className="text-xs font-bold text-white bg-kid-blue px-3 py-2.5 rounded-xl shadow-sm whitespace-nowrap">
                 U{currentAge} ({currentAge}岁)
               </span>
             </div>
             
             <div className="mt-3 grid grid-cols-2 gap-2">
                <div>
                   <label className="text-[10px] font-bold text-slate-400 ml-1">组别关键字</label>
                   <input
                     type="text"
                     value={searchConfig.groupKeywords}
                     onChange={(e) => onSearchConfigChange('groupKeywords', e.target.value)}
                     className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
                   />
                </div>
                <div>
                   <label className="text-[10px] font-bold text-slate-400 ml-1">项目</label>
                   <input
                     type="text"
                     value={searchConfig.itemKeywords}
                     onChange={(e) => onSearchConfigChange('itemKeywords', e.target.value)}
                     className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
                     placeholder="男单"
                   />
                </div>
             </div>
          </div>
        )}

        {activeTab === 'player' && (
          <div className="bg-orange-50/50 p-4 rounded-2xl border border-orange-100 animate-fade-in">
             <label className="block text-xs font-bold text-slate-500 mb-2 ml-1 text-center">输入小选手的名字</label>
             <input
                type="text"
                value={searchConfig.targetPlayerName || ''}
                onChange={(e) => onSearchConfigChange('targetPlayerName', e.target.value)}
                className="w-full px-4 py-3 bg-white border-2 border-orange-200 rounded-xl text-lg text-center font-black text-slate-800 focus:outline-none focus:border-kid-orange placeholder:text-slate-300 placeholder:font-normal"
                placeholder="例如：林丹"
              />
          </div>
        )}

        {/* PART B: 高级筛选 (Advanced Settings) */}
        <div>
          <button 
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center justify-center gap-2 text-sm font-extrabold text-kid-primary hover:text-white hover:bg-kid-primary border-2 border-kid-primary/20 hover:border-kid-primary px-4 py-2.5 rounded-xl w-full transition-all"
          >
            {showAdvanced ? '收起筛选设置' : '⚙️ 展开筛选设置 (城市/赛事)'}
            {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          
          {showAdvanced && (
            <div className="mt-3 p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-3 animate-fade-in text-sm">
                <div className="grid grid-cols-2 gap-3">
                   <div>
                      <label className="block text-[10px] font-bold text-slate-400 mb-1">
                        省份
                      </label>
                      <input
                        type="text"
                        value={searchConfig.province}
                        onChange={(e) => onSearchConfigChange('province', e.target.value)}
                        className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
                        placeholder="例如：广东"
                      />
                   </div>
                   <div>
                      <label className="block text-[10px] font-bold text-slate-400 mb-1">
                        城市
                      </label>
                      <input
                        type="text"
                        value={searchConfig.city}
                        onChange={(e) => onSearchConfigChange('city', e.target.value)}
                        className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
                        placeholder="例如：广州"
                      />
                   </div>
                </div>
                <div>
                   <label className="block text-[10px] font-bold text-slate-400 mb-1">
                     赛事包含关键字 <span className="text-kid-primary font-normal">(逗号隔开表示 "或" 关系)</span>
                   </label>
                   <input
                      type="text"
                      value={searchConfig.gameKeywords}
                      onChange={(e) => onSearchConfigChange('gameKeywords', e.target.value)}
                      className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
                      placeholder="例如：少年,小学"
                    />
                </div>
            </div>
          )}
        </div>

        {/* PART C: 行动按钮 (Action Buttons) */}
        {activeTab === 'rank' && (
             <button
                onClick={onScanRankings}
                disabled={status === StepStatus.LOADING}
                className="group w-full py-3.5 bg-kid-primary text-white rounded-xl font-bold shadow-lg shadow-indigo-200 hover:shadow-indigo-300 hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:translate-y-0 active:scale-95 flex items-center justify-center gap-2 animate-fade-in"
              >
                {status === StepStatus.LOADING ? (
                   <span className="flex items-center gap-2">
                     <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                     扫描中...
                   </span>
                ) : (
                  <>
                    <Search className="w-5 h-5" /> 扫描积分榜
                  </>
                )}
              </button>
        )}

        {activeTab === 'player' && (
             <button
                onClick={onDirectSearch}
                disabled={status === StepStatus.LOADING}
                className="group w-full py-3.5 bg-kid-orange text-white rounded-xl font-bold shadow-lg shadow-orange-200 hover:shadow-orange-300 hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:translate-y-0 active:scale-95 flex items-center justify-center gap-2 animate-fade-in"
              >
                 {status === StepStatus.LOADING ? (
                   <span className="flex items-center gap-2">
                     <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                     寻找中...
                   </span>
                ) : (
                  <>
                   <UserSearch className="w-5 h-5" /> 搜索历史战绩
                  </>
                )}
              </button>
        )}

        {/* ⚠️ 错误恢复按钮 (仅当有 Auth Error 时显示) */}
        {hasAuthError && (
          <div className="animate-fade-in bg-red-50 p-3 rounded-xl border border-red-100 flex flex-col items-center text-center gap-2">
             <div className="text-xs text-red-600 font-bold flex items-center gap-1">
               <AlertTriangle className="w-4 h-4" />
               检测到凭证失效或不存在
             </div>
             <button 
               onClick={onRefreshCredentials}
               className="w-full py-2 bg-white border border-red-200 text-red-500 rounded-lg text-xs font-bold hover:bg-red-500 hover:text-white transition-colors flex items-center justify-center gap-2 shadow-sm"
             >
               <RotateCcw className="w-3 h-3" />
               刷新凭证
             </button>
          </div>
        )}

        {/* 进度条 (Loading State) */}
        {status === StepStatus.LOADING && (
          <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
             <div className="flex justify-between text-xs font-bold text-slate-500 mb-1">
                <span>处理进度</span>
                <span>{progress}%</span>
             </div>
             <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-kid-primary to-kid-purple transition-all duration-300"
                  style={{ width: `${progress}%` }}
                ></div>
             </div>
          </div>
        )}
        
        {/* Cache Status - Moved to bottom */}
        {lastCacheTime && (
            <div className="flex items-center justify-between px-2 pt-1">
               <div className="flex items-center gap-2 text-[10px] text-slate-400">
                  <RefreshCw className="w-3 h-3" />
                  <span>缓存时间: {lastCacheTime}</span>
               </div>
               <button onClick={onClearCache} className="text-[10px] flex items-center gap-1 text-slate-400 hover:text-red-500 transition-colors">
                 <Trash2 className="w-3 h-3" />
               </button>
            </div>
        )}

      </div>
    </div>
  );
};

export default ConfigPanel;