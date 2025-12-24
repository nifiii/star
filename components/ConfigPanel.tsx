import React, { useEffect, useState, useRef } from 'react';
import { ApiHeaderConfig, SearchConfig, StepStatus, UserCredentials } from '../types';
import { Calendar, Search, ChevronDown, ChevronUp, Trophy, UserSearch, RefreshCw, Trash2, RotateCcw, AlertTriangle, Filter, Tag, XCircle } from 'lucide-react';
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
  onScanRankings: () => void;
  onDirectSearch: () => void;
  onDemo: () => void;
  lastCacheTime?: string;
  hasAuthError?: boolean;
  onRefreshCredentials?: () => void;
}

// --- DATA CONSTANTS ---

const GROUP_SECTIONS = [
  {
    title: 'U系列 (年龄)',
    options: [
      { label: 'U7', value: 'U7' },
      { label: 'U8', value: 'U8' },
      { label: 'U9', value: 'U9' },
      { label: 'U10', value: 'U10' },
      { label: 'U11', value: 'U11' },
      { label: 'U12', value: 'U12' },
      { label: 'U13', value: 'U13' },
      { label: 'U14', value: 'U14' },
      { label: 'U15', value: 'U15' },
      { label: 'U16', value: 'U16' },
    ]
  },
  {
    title: '学段 / 级别',
    options: [
      { label: '儿童/小学', value: '儿童,小学' },
      { label: '少年', value: '少年' },
      { label: '初中', value: '初中' },
      { label: '高中', value: '高中' },
      { label: '公开组', value: '公开' },
      { label: '甲组', value: '甲' },
      { label: '乙组', value: '乙' },
      { label: '丙组', value: '丙' },
    ]
  }
];

const ITEM_OPTIONS = [
  { label: '男单', value: '男单,男子单打,男A,男B' },
  { label: '女单', value: '女单,女子单打,女A,女B' },
  { label: '男双', value: '男双,男子双打' },
  { label: '女双', value: '女双,女子双打' },
  { label: '混双', value: '混双,混合双打' },
  { label: '团体', value: '团体' },
];

const ConfigPanel: React.FC<Props> = ({ 
  config, userCredentials, searchConfig, status, progress,
  onSearchConfigChange, onClearCache,
  onScanRankings, onDirectSearch, onDemo, lastCacheTime,
  hasAuthError, onRefreshCredentials
}) => {
  
  const [activeTab, setActiveTab] = useState<'rank' | 'player'>('player');
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  // Dropdown States
  const [isGroupOpen, setIsGroupOpen] = useState(false);
  const [isItemOpen, setIsItemOpen] = useState(false);
  
  const groupRef = useRef<HTMLDivElement>(null);
  const itemRef = useRef<HTMLDivElement>(null);

  // Click Outside Handler
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (groupRef.current && !groupRef.current.contains(event.target as Node)) {
        setIsGroupOpen(false);
      }
      if (itemRef.current && !itemRef.current.contains(event.target as Node)) {
        setIsItemOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);
  
  // Auto-init defaults
  useEffect(() => {
    if (!searchConfig.groupKeywords) {
        const keywords = generateDefaultKeywords(searchConfig.birthYear);
        onSearchConfigChange('groupKeywords', keywords);
    }
  }, [searchConfig.birthYear]);

  const currentAge = new Date().getFullYear() - searchConfig.birthYear;

  // Keyword Toggler
  const toggleKeyword = (field: 'groupKeywords' | 'itemKeywords', valueString: string) => {
    const currentStr = searchConfig[field] || '';
    const currentParts = new Set(currentStr.split(/[,，]/).map(s => s.trim()).filter(s => s));
    const newValues = valueString.split(/[,，]/).map(s => s.trim());
    
    // Determine if we are adding or removing (if all new values exist, we remove)
    const isAlreadyActive = newValues.every(v => currentParts.has(v));

    if (isAlreadyActive) {
      newValues.forEach(v => currentParts.delete(v));
    } else {
      newValues.forEach(v => currentParts.add(v));
    }
    
    onSearchConfigChange(field, Array.from(currentParts).join(','));
  };

  const isKeywordActive = (field: 'groupKeywords' | 'itemKeywords', valueString: string) => {
     const currentStr = searchConfig[field] || '';
     const currentParts = currentStr.split(/[,，]/).map(s => s.trim().toUpperCase());
     const targetParts = valueString.split(/[,，]/).map(s => s.trim().toUpperCase());
     // Considered active if all target parts are present
     return targetParts.length > 0 && targetParts.every(t => currentParts.includes(t));
  };

  // Toggle Handlers with Mutual Exclusion
  const toggleGroupDropdown = () => {
    if (!isGroupOpen) setIsItemOpen(false); // Close other
    setIsGroupOpen(!isGroupOpen);
  };

  const toggleItemDropdown = () => {
    if (!isItemOpen) setIsGroupOpen(false); // Close other
    setIsItemOpen(!isItemOpen);
  };

  return (
    // Removed overflow-hidden to allow dropdowns to float over siblings
    <div className="bg-white rounded-[2rem] shadow-xl border-2 border-slate-100 relative transition-all duration-300">
      {/* Top Decor */}
      <div className="h-3 bg-gradient-to-r from-kid-primary via-kid-purple to-kid-accent rounded-t-[2rem]"></div>

      {/* 1. Tabs */}
      <div className="flex border-b border-slate-100">
        <button
          onClick={() => setActiveTab('player')}
          className={`flex-1 py-4 text-sm font-bold flex items-center justify-center gap-2 transition-colors relative ${
            activeTab === 'player' ? 'text-kid-orange bg-white first:rounded-tl-[2rem]' : 'text-slate-400 bg-slate-50 hover:bg-slate-100 first:rounded-tl-[2rem]'
          }`}
        >
          <UserSearch className={`w-4 h-4 ${activeTab === 'player' ? 'text-kid-orange' : ''}`} />
          查小选手
          {activeTab === 'player' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-kid-orange mx-8 rounded-t-full"></div>}
        </button>
        <button
          onClick={() => setActiveTab('rank')}
          className={`flex-1 py-4 text-sm font-bold flex items-center justify-center gap-2 transition-colors relative ${
            activeTab === 'rank' ? 'text-kid-primary bg-white last:rounded-tr-[2rem]' : 'text-slate-400 bg-slate-50 hover:bg-slate-100 last:rounded-tr-[2rem]'
          }`}
        >
          <Trophy className={`w-4 h-4 ${activeTab === 'rank' ? 'text-kid-yellow' : ''}`} />
          查排行榜
          {activeTab === 'rank' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-kid-primary mx-8 rounded-t-full"></div>}
        </button>
      </div>

      {/* 2. Content */}
      <div className="p-5 space-y-5">
        
        {/* PART A: Player Search */}
        {activeTab === 'player' && (
          <div className="space-y-4 animate-fade-in">
            <div className="bg-orange-50/50 p-4 rounded-2xl border border-orange-100">
               <label className="block text-xs font-bold text-slate-500 mb-2 ml-1 text-center">输入小选手的名字</label>
               <input
                  type="text"
                  value={searchConfig.targetPlayerName || ''}
                  onChange={(e) => onSearchConfigChange('targetPlayerName', e.target.value)}
                  className="w-full px-4 py-3 bg-white border-2 border-orange-200 rounded-xl text-lg text-center font-black text-slate-800 focus:outline-none focus:border-kid-orange placeholder:text-slate-300 placeholder:font-normal"
                  placeholder="例如：林丹"
                />
            </div>
            
            {/* Gender Filter */}
            <div className="flex justify-center gap-3">
               <button 
                 onClick={() => onSearchConfigChange('playerGender', searchConfig.playerGender === 'M' ? null : 'M')}
                 className={`flex-1 py-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                    searchConfig.playerGender === 'M' 
                    ? 'bg-blue-500 border-blue-500 text-white shadow-md shadow-blue-200' 
                    : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                 }`}
               >
                 <span className="text-base">👦</span> 只看男生
               </button>
               <button 
                 onClick={() => onSearchConfigChange('playerGender', searchConfig.playerGender === 'F' ? null : 'F')}
                 className={`flex-1 py-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                    searchConfig.playerGender === 'F' 
                    ? 'bg-pink-500 border-pink-500 text-white shadow-md shadow-pink-200' 
                    : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                 }`}
               >
                 <span className="text-base">👧</span> 只看女生
               </button>
            </div>
          </div>
        )}

        {/* PART B: Rankings Search */}
        {activeTab === 'rank' && (
          <div className="space-y-5 animate-fade-in relative z-20">
            {/* Age */}
            <div className="bg-blue-50/30 p-3 rounded-2xl border border-blue-100/50">
               <label className="block text-xs font-bold text-slate-400 mb-1 ml-1 flex justify-between">
                 <span>出生年份</span>
                 <span className="text-kid-blue">U{currentAge} ({currentAge}岁)</span>
               </label>
               <div className="relative">
                 <Calendar className="absolute left-3 top-2.5 w-4 h-4 text-kid-blue" />
                 <input
                   type="number"
                   value={searchConfig.birthYear}
                   onChange={(e) => onSearchConfigChange('birthYear', Number(e.target.value))}
                   className="w-full pl-9 px-3 py-2 bg-white border border-blue-200 rounded-xl text-sm focus:outline-none focus:border-kid-blue font-bold text-slate-700 shadow-sm"
                 />
               </div>
            </div>

            {/* Group Filter Dropdown */}
            {/* Increased Z-index to 50 for open state to guarantee it sits above everything */}
            <div className={`relative ${isGroupOpen ? 'z-50' : 'z-20'}`} ref={groupRef}>
               <label className="flex items-center gap-1.5 text-xs font-bold text-slate-500 mb-2 ml-1">
                 <Filter className="w-3.5 h-3.5 text-kid-primary" /> 组别筛选 
               </label>
               
               <button 
                 onClick={toggleGroupDropdown}
                 className={`w-full text-left px-4 py-3 bg-white border rounded-xl text-sm font-medium text-slate-700 shadow-sm flex justify-between items-center transition-all ${isGroupOpen ? 'border-kid-primary ring-2 ring-kid-primary/10' : 'border-slate-200 hover:border-kid-primary/50'}`}
               >
                 <span className="truncate pr-4">
                   {searchConfig.groupKeywords 
                      ? <span className="text-slate-800 font-bold">{searchConfig.groupKeywords}</span> 
                      : <span className="text-slate-400">全部组别 (不限)</span>
                   }
                 </span>
                 <div className="flex items-center gap-2">
                    {searchConfig.groupKeywords && (
                        <div 
                          onClick={(e) => {
                             e.stopPropagation();
                             onSearchConfigChange('groupKeywords', '');
                          }}
                          className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                        >
                            <XCircle className="w-4 h-4" />
                        </div>
                    )}
                    {isGroupOpen ? <ChevronUp className="w-4 h-4 text-kid-primary" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                 </div>
               </button>

               {isGroupOpen && (
                 <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-xl border border-slate-100 p-4 animate-fade-in origin-top ring-1 ring-slate-900/5">
                    {GROUP_SECTIONS.map((section, idx) => (
                      <div key={idx} className="mb-4 last:mb-0">
                         <h4 className="text-[10px] font-bold text-slate-400 uppercase mb-2 ml-1 tracking-wider">{section.title}</h4>
                         <div className={`grid gap-2 ${section.title.includes('U系列') ? 'grid-cols-5' : 'grid-cols-3'}`}>
                            {section.options.map(opt => {
                               const isActive = isKeywordActive('groupKeywords', opt.value);
                               return (
                                 <button
                                   key={opt.label}
                                   onClick={() => toggleKeyword('groupKeywords', opt.value)}
                                   className={`text-xs py-2 px-1 rounded-lg transition-all active:scale-95 font-medium border ${
                                     isActive 
                                       ? 'bg-kid-primary text-white border-kid-primary shadow-md shadow-indigo-100' 
                                       : 'bg-slate-50 text-slate-600 border-slate-100 hover:border-kid-primary/30 hover:bg-white'
                                   }`}
                                 >
                                   {opt.label}
                                 </button>
                               )
                            })}
                         </div>
                      </div>
                    ))}
                 </div>
               )}
            </div>

            {/* Item Filter Dropdown */}
            {/* Increased Z-index to 50 for open state */}
            <div className={`relative ${isItemOpen ? 'z-50' : 'z-10'}`} ref={itemRef}>
               <label className="flex items-center gap-1.5 text-xs font-bold text-slate-500 mb-2 ml-1">
                 <Tag className="w-3.5 h-3.5 text-kid-secondary" /> 比赛项目 
               </label>
               
               <button 
                 onClick={toggleItemDropdown}
                 className={`w-full text-left px-4 py-3 bg-white border rounded-xl text-sm font-medium text-slate-700 shadow-sm flex justify-between items-center transition-all ${isItemOpen ? 'border-kid-secondary ring-2 ring-kid-secondary/10' : 'border-slate-200 hover:border-kid-secondary/50'}`}
               >
                 <span className="truncate pr-4">
                   {searchConfig.itemKeywords 
                      ? <span className="text-slate-800 font-bold">{searchConfig.itemKeywords}</span> 
                      : <span className="text-slate-400">全部项目 (不限)</span>
                   }
                 </span>
                 <div className="flex items-center gap-2">
                    {searchConfig.itemKeywords && (
                        <div 
                          onClick={(e) => {
                             e.stopPropagation();
                             onSearchConfigChange('itemKeywords', '');
                          }}
                          className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                        >
                            <XCircle className="w-4 h-4" />
                        </div>
                    )}
                    {isItemOpen ? <ChevronUp className="w-4 h-4 text-kid-secondary" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                 </div>
               </button>

               {isItemOpen && (
                 <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-xl border border-slate-100 p-4 animate-fade-in origin-top ring-1 ring-slate-900/5">
                    <div className="grid grid-cols-3 gap-2">
                        {ITEM_OPTIONS.map(item => {
                          const active = isKeywordActive('itemKeywords', item.value);
                          return (
                            <button
                              key={item.label}
                              onClick={() => toggleKeyword('itemKeywords', item.value)}
                              className={`text-xs py-2.5 px-2 rounded-lg border transition-all active:scale-95 font-medium ${
                                active 
                                  ? 'bg-kid-secondary text-white border-kid-secondary shadow-md shadow-orange-100' 
                                  : 'bg-slate-50 text-slate-600 border-slate-100 hover:border-kid-secondary/30 hover:bg-white'
                              }`}
                            >
                              {item.label}
                            </button>
                          )
                        })}
                    </div>
                 </div>
               )}
            </div>
          </div>
        )}

        {/* PART C: Advanced */}
        <div className="pt-2 border-t border-slate-50 relative z-0">
          <button 
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center justify-between w-full text-xs font-bold text-slate-400 hover:text-kid-primary transition-colors py-1"
          >
            <span>更多筛选 (城市/赛事名)</span>
            {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          
          {showAdvanced && (
            <div className="mt-3 p-3 bg-slate-50/80 rounded-xl border border-slate-100 space-y-3 animate-fade-in text-sm">
                <div className="grid grid-cols-2 gap-3">
                   <div>
                      <label className="block text-[10px] font-bold text-slate-400 mb-1">省份</label>
                      <input
                        type="text"
                        value={searchConfig.province}
                        onChange={(e) => onSearchConfigChange('province', e.target.value)}
                        className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:border-kid-primary focus:outline-none"
                        placeholder="例如：广东"
                      />
                   </div>
                   <div>
                      <label className="block text-[10px] font-bold text-slate-400 mb-1">城市</label>
                      <input
                        type="text"
                        value={searchConfig.city}
                        onChange={(e) => onSearchConfigChange('city', e.target.value)}
                        className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:border-kid-primary focus:outline-none"
                        placeholder="例如：广州"
                      />
                   </div>
                </div>
                <div>
                   <label className="block text-[10px] font-bold text-slate-400 mb-1">
                     赛事关键字 <span className="font-normal text-slate-300">(过滤比赛名称)</span>
                   </label>
                   <input
                      type="text"
                      value={searchConfig.gameKeywords}
                      onChange={(e) => onSearchConfigChange('gameKeywords', e.target.value)}
                      className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:border-kid-primary focus:outline-none"
                      placeholder="例如：少年,小学"
                    />
                </div>
            </div>
          )}
        </div>

        {/* PART D: Action Buttons */}
        {activeTab === 'player' && (
             <button
                onClick={onDirectSearch}
                disabled={status === StepStatus.LOADING}
                className="group w-full py-3.5 bg-kid-orange text-white rounded-xl font-bold shadow-lg shadow-orange-200 hover:shadow-orange-300 hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:translate-y-0 active:scale-95 flex items-center justify-center gap-2 animate-fade-in relative z-0"
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

        {activeTab === 'rank' && (
             <button
                onClick={onScanRankings}
                disabled={status === StepStatus.LOADING}
                className="group w-full py-3.5 bg-kid-primary text-white rounded-xl font-bold shadow-lg shadow-indigo-200 hover:shadow-indigo-300 hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:translate-y-0 active:scale-95 flex items-center justify-center gap-2 animate-fade-in relative z-0"
              >
                {status === StepStatus.LOADING ? (
                   <span className="flex items-center gap-2">
                     <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                     扫描中...
                   </span>
                ) : (
                  <>
                    <Search className="w-5 h-5" /> 搜索排名数据
                  </>
                )}
              </button>
        )}

        {/* ⚠️ 错误恢复按钮 (仅当有 Auth Error 时显示) */}
        {hasAuthError && (
          <div className="animate-fade-in bg-red-50 p-3 rounded-xl border border-red-100 flex flex-col items-center text-center gap-2 relative z-0">
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
          <div className="bg-slate-50 rounded-lg p-3 border border-slate-100 relative z-0">
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
            <div className="flex items-center justify-between px-2 pt-1 border-t border-slate-50 mt-2 relative z-0">
               <div className="flex items-center gap-2 text-[10px] text-slate-400">
                  <RefreshCw className="w-3 h-3" />
                  <span>缓存时间: {lastCacheTime}</span>
               </div>
               <button onClick={onClearCache} className="text-[10px] flex items-center gap-1 text-slate-400 hover:text-red-500 transition-colors" title="清理缓存">
                 <Trash2 className="w-3 h-3" />
               </button>
            </div>
        )}

      </div>
    </div>
  );
};

export default ConfigPanel;