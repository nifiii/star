import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Trophy, ArrowUpRight, Download, MapPin, ChevronLeft, ChevronRight, LoaderCircle, CircleAlert, RotateCcw, Check, X, Minus, Users, ListFilter } from 'lucide-react';
import ConfigPanel from './components/ConfigPanel';
import { clearQueryCache, fetchAggregatedRankings, fetchPlayerMatches, type QueryResult } from './services/huaTiHuiService';
import { getMatchOutcome, normalizeName, type MatchOutcome } from './services/matchResult';
import { StepStatus, type ApiHeaderConfig, type AppView, type SearchConfig, type PlayerRank, type MatchScoreResult } from './types';

const STORAGE_KEY = 'hth_search_v2';
const CACHE_PREFIX = 'hth_cache_';
const CACHE_DURATION = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 20;
const CONFIG: ApiHeaderConfig = { token: '', sn: '', snTime: 0 };
const DEFAULT_SEARCH: SearchConfig = { province: '广东省', city: '广州市', gameKeywords: '', uKeywords: 'U8', levelKeywords: '', itemKeywords: '男单', targetPlayerName: '' };
const EMPTY_SEARCH: SearchConfig = { ...DEFAULT_SEARCH, city: '', uKeywords: '', itemKeywords: '', playerGender: null };

interface ResultState<T> extends QueryResult<T> {
  status: StepStatus;
  error: string;
  query?: SearchConfig;
  timestamp?: number;
  cached?: boolean;
}
const emptyResult = <T,>(): ResultState<T> => ({ data: [], status: StepStatus.IDLE, error: '' });
const formatNumber = (value: number) => value.toLocaleString('zh-CN');

function loadSearch(): SearchConfig {
  try { return { ...DEFAULT_SEARCH, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'), province: '广东省' }; }
  catch { return DEFAULT_SEARCH; }
}

function cacheKey(view: AppView, query: SearchConfig) {
  // Include only fields used by each endpoint, while preserving all effective filters.
  return CACHE_PREFIX + 'ui_v3_' + view + '_' + JSON.stringify(view === 'PLAYER_HISTORY'
    ? [query.targetPlayerName, query.province, query.city, query.playerGender, query.gameKeywords]
    : query);
}

function readCache<T>(key: string): ResultState<T> | null {
  try {
    const cached = JSON.parse(localStorage.getItem(key) || 'null');
    if (cached && Array.isArray(cached.data) && cached.data.length && Date.now() - cached.timestamp < CACHE_DURATION) {
      return { ...cached, cached: true, status: StepStatus.COMPLETE, error: '' };
    }
    if (cached) localStorage.removeItem(key);
  } catch { /* A blocked or full localStorage must not prevent a server query. */ }
  return null;
}

function ShuttleMark({ className = '' }: { className?: string }) {
  return <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true"><path d="m7 5 17 3 3 17-7-1-6-6-7-6V5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="m8 6 13 17M15 7l9 17M25 9 9 7M26 16l-11-3M6 17l9 9-4 3a4 4 0 0 1-6-5l1-7Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

function OutcomeBadge({ outcome }: { outcome: MatchOutcome }) {
  const Icon = outcome === 'win' ? Check : outcome === 'loss' ? X : Minus;
  return <span className={`outcome ${outcome}`}><Icon size={12} />{outcome === 'win' ? '胜' : outcome === 'loss' ? '负' : '待确认'}</span>;
}

function RankBadge({ rank }: { rank: string | number }) {
  const n = Number(rank);
  return <span className={`rank-badge ${n >= 1 && n <= 3 ? `rank-${n}` : ''}`}>{n === 1 && <Trophy size={13} />}{rank}</span>;
}

function PlayerName({ name, selected }: { name: string; selected: string }) {
  return <span className={selected && normalizeName(name || '').includes(normalizeName(selected)) ? 'selected-name' : ''}>{name || '待定'}</span>;
}

export const App: React.FC = () => {
  const [view, setView] = useState<AppView>('PLAYER_HISTORY');
  const [search, setSearch] = useState(loadSearch);
  const [matches, setMatches] = useState<ResultState<MatchScoreResult>>(emptyResult);
  const [rankings, setRankings] = useState<ResultState<PlayerRank>>(emptyResult);
  const [page, setPage] = useState(1);
  const [progress, setProgress] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<{ message: string; error?: boolean } | null>(null);
  const resultRef = useRef<HTMLElement>(null);
  const current = view === 'PLAYER_HISTORY' ? matches : rankings;
  const isPlayer = view === 'PLAYER_HISTORY';
  const loading = matches.status === StepStatus.LOADING || rankings.status === StepStatus.LOADING;
  const selectedPlayer = matches.query?.targetPlayerName || '';

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(search)); } catch { /* Search remains usable without storage. */ }
  }, [search]);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const stats = useMemo(() => {
    const result = { wins: 0, losses: 0, pending: 0, rate: 0, events: new Set(matches.data.map(m => m.raceId)).size };
    matches.data.forEach(m => {
      const outcome = getMatchOutcome(m, selectedPlayer);
      if (outcome === 'win') result.wins++;
      else if (outcome === 'loss') result.losses++;
      else result.pending++;
    });
    result.rate = result.wins + result.losses ? Math.round(100 * result.wins / (result.wins + result.losses)) : 0;
    return result;
  }, [matches.data, selectedPlayer]);

  async function runQuery(targetView = view, query = search) {
    const snapshot = { ...query, targetPlayerName: query.targetPlayerName?.trim() || '' };
    if (targetView === 'PLAYER_HISTORY' && !snapshot.targetPlayerName) return;
    setPage(1);
    setProgress(0);
    const key = cacheKey(targetView, snapshot);
    const onProgress = (_message: string, value: number) => setProgress(value);
    if (targetView === 'PLAYER_HISTORY') {
      const cached = readCache<MatchScoreResult>(key);
      if (cached) { setMatches(cached); return; }
      setMatches({ ...emptyResult(), status: StepStatus.LOADING, query: snapshot });
      try {
        const result = await fetchPlayerMatches(CONFIG, snapshot.targetPlayerName, snapshot, onProgress);
        const state: ResultState<MatchScoreResult> = { ...result, status: StepStatus.COMPLETE, error: '', query: snapshot, timestamp: Date.now() };
        setMatches(state);
        saveCache(key, state);
      } catch (error) {
        setMatches({ ...emptyResult(), status: StepStatus.ERROR, query: snapshot, error: error instanceof Error ? error.message : '查询失败，请稍后重试。' });
      }
    } else {
      const cached = readCache<PlayerRank>(key);
      if (cached) { setRankings(cached); return; }
      setRankings({ ...emptyResult(), status: StepStatus.LOADING, query: snapshot });
      try {
        const result = await fetchAggregatedRankings(CONFIG, snapshot, onProgress);
        const state: ResultState<PlayerRank> = { ...result, status: StepStatus.COMPLETE, error: '', query: snapshot, timestamp: Date.now() };
        setRankings(state);
        saveCache(key, state);
      } catch (error) {
        setRankings({ ...emptyResult(), status: StepStatus.ERROR, query: snapshot, error: error instanceof Error ? error.message : '查询失败，请稍后重试。' });
      }
    }
  }

  function saveCache<T>(key: string, state: ResultState<T>) {
    try { if (state.data.length) localStorage.setItem(key, JSON.stringify(state)); }
    catch { /* Storage quota must not turn a successful query into an error. */ }
  }
  function clearCache() {
    try { Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX)).forEach(k => localStorage.removeItem(k)); } catch { /* Session cache is still cleared. */ }
    clearQueryCache();
    setNotice({ message: '查询缓存已清除，下次查询将获取最新数据。' });
  }
  function switchView(next: AppView) { setView(next); setPage(1); }
  function openPlayer(name: string) {
    const query = { ...search, targetPlayerName: name };
    setSearch(query);
    switchView('PLAYER_HISTORY');
    void runQuery('PLAYER_HISTORY', query);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function exportExcel() {
    setExporting(true);
    try {
      // The workbook library is only needed when exporting, keeping the initial page light.
      const XLSX = await import('xlsx');
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(current.data), '查询结果');
      XLSX.writeFile(workbook, isPlayer ? `${selectedPlayer}_比赛记录.xlsx` : '赛事成绩.xlsx');
    } catch {
      setNotice({ message: '导出失败，请稍后重试。', error: true });
    } finally {
      setExporting(false);
    }
  }
  function changePage(next: number) {
    setPage(next);
    resultRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    resultRef.current?.focus({ preventScroll: true });
  }

  const pages = Math.max(1, Math.ceil(current.data.length / PAGE_SIZE));
  const start = (page - 1) * PAGE_SIZE;
  const filters = current.query ? [
    current.query.province, current.query.city,
    current.query.playerGender === 'M' ? '男子' : current.query.playerGender === 'F' ? '女子' : '',
    current.query.gameKeywords ? `赛事：${current.query.gameKeywords}` : '',
    ...(!isPlayer ? [current.query.targetPlayerName, current.query.uKeywords, current.query.levelKeywords,
      current.query.itemKeywords.split(',').filter(v => ['男单', '女单', '男双', '女双', '混双', '团体'].includes(v)).join('、') || current.query.itemKeywords] : []),
  ].filter(Boolean) : [];
  const hasResults = current.status === StepStatus.COMPLETE && current.data.length > 0;

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">跳转到查询内容</a>
    <header className="site-header">
      <div className="header-inner">
        <a href="#" className="brand" aria-label="STAR 羽毛球未来之星首页" onClick={e => { e.preventDefault(); if (!loading) switchView('PLAYER_HISTORY'); }}><span className="brand-mark"><ShuttleMark /></span><span className="brand-type">STAR<span>羽毛球未来之星</span></span></a>
        <nav className="main-nav" aria-label="主要导航">
          <button disabled={loading} aria-current={isPlayer ? 'page' : undefined} className={isPlayer ? 'active' : ''} onClick={() => switchView('PLAYER_HISTORY')}><Search size={17} />比赛战绩</button>
          <button disabled={loading} aria-current={!isPlayer ? 'page' : undefined} className={!isPlayer ? 'active' : ''} onClick={() => switchView('DASHBOARD_RANKS')}><Trophy size={17} />赛事成绩</button>
        </nav>
        <span className="header-region"><MapPin size={14} />广东赛事</span>
      </div>
    </header>

    <main id="main-content" className="main-content">
      <div className="page-heading"><div><div className="eyebrow">{isPlayer ? 'PLAYER RECORDS' : 'TOURNAMENT RESULTS'}</div><h1>{isPlayer ? '每一场表现，清晰可查' : '赛事成绩，一目了然'}</h1><p>{isPlayer ? '按运动员姓名查找比赛比分，回顾单打、双打与团体赛表现。' : '按组别、项目和城市筛选赛事排名，点击运动员可查看比赛战绩。'}</p></div><span className="scope-label"><span />比分 · 成绩查询</span></div>

      <ConfigPanel key={view} view={view} searchConfig={search} loading={loading} onChange={(key, value) => setSearch(prev => ({ ...prev, [key]: value }))} onSubmit={() => void runQuery()} onReset={() => setSearch(EMPTY_SEARCH)} />

      {isPlayer && hasResults && <div className="player-overview"><div className="player-identity"><div className="avatar">{selectedPlayer.slice(0, 1)}</div><div><span className="eyebrow">运动员战绩</span><h2>{selectedPlayer}</h2><p>覆盖 {formatNumber(stats.events)} 项赛事</p></div></div><div className="stats-grid"><div><span>比赛记录</span><strong>{formatNumber(matches.data.length)}<small>场</small></strong></div><div><span>获胜 / 失利</span><strong><span className="text-green">{stats.wins}</span><i>/</i>{stats.losses}</strong></div><div><span>胜率 <span className="stat-note">仅已确认</span></span><strong>{stats.wins + stats.losses ? stats.rate : '—'}<small>{stats.wins + stats.losses ? '%' : ''}</small></strong></div><div><span>待确认</span><strong>{stats.pending}<small>场</small></strong></div></div></div>}

      <section ref={resultRef} tabIndex={-1} className="results-panel" aria-labelledby="results-heading" aria-busy={loading}>
        <div className="results-toolbar">
          <div className="results-title"><h2 id="results-heading">{isPlayer ? '比赛记录' : '赛事成绩'}{hasResults && <span className="count-badge">{formatNumber(current.data.length)}</span>}</h2>{current.cached && hasResults && <span className="cache-label">本地缓存</span>}</div>
          <div className="result-actions"><button className="button button-secondary export-button" disabled={!hasResults || loading || exporting} onClick={exportExcel}>{exporting ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}<span>{exporting ? '导出中' : '导出 Excel'}</span></button></div>
        </div>

        {hasResults && <div className="result-context"><span><ListFilter size={13} />{filters.join(' / ')}</span><span>{isPlayer ? '原始比分按选手 A : B 展示' : '各赛事、组别分别排名'}</span></div>}

        {current.status === StepStatus.IDLE && <div className="empty-state initial-state"><div className="empty-illustration"><ShuttleMark /></div><h3>{isPlayer ? '从一位运动员开始' : '查找你关注的赛事成绩'}</h3><p>{isPlayer ? '在上方输入姓名，即可查看比赛记录与比分。' : '选择组别与比赛项目，或直接输入姓名查询。'}</p><div className="empty-steps"><span><b>01</b>填写查询条件</span><i /><span><b>02</b>查看比赛结果</span><i /><span><b>03</b>导出保存</span></div></div>}
        {current.status === StepStatus.LOADING && <div className="empty-state" role="status"><LoaderCircle className="spin text-green" size={32} /><h3>正在查找{isPlayer ? '比赛记录' : '赛事成绩'}</h3><p>请稍候，结果即将呈现。</p><div className="progress-track" role="progressbar" aria-label="查询进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div></div>}
        {current.status === StepStatus.ERROR && <div className="empty-state error-state" role="alert"><CircleAlert size={32} /><h3>暂时无法完成查询</h3><p>{current.error}</p><button className="button button-secondary" onClick={() => void runQuery(view, current.query)}><RotateCcw size={16} />重新查询</button></div>}
        {current.status === StepStatus.COMPLETE && !current.data.length && <div className="empty-state"><Search size={32} /><h3>未找到相关记录</h3><p>请确认姓名，或尝试清除城市、性别和赛事筛选后重新查询。</p><button className="text-button" onClick={() => { setSearch(prev => ({ ...EMPTY_SEARCH, targetPlayerName: prev.targetPlayerName })); document.getElementById('player-name')?.focus(); }}>放宽筛选条件<ArrowUpRight size={15} /></button></div>}

        {hasResults && isPlayer && <>
          <div className="desktop-results"><table className="data-table match-table"><thead><tr><th>时间 / 轮次</th><th>选手 A</th><th className="score-column">比分 / 结果</th><th>选手 B</th><th>赛事 / 组别</th></tr></thead><tbody>{matches.data.slice(start, start + PAGE_SIZE).map((m, i) => <tr key={`${m.matchId || m.raceId}-${i}`}><td><span className="cell-primary match-time">{m.matchTime || '时间待定'}</span><span className="cell-secondary">{m.round || '轮次待定'}</span></td><td className="player-cell"><PlayerName name={m.playerA} selected={selectedPlayer} /></td><td className="score-column"><div className="score-display"><strong>{m.score || '—'}</strong><OutcomeBadge outcome={getMatchOutcome(m, selectedPlayer)} /></div></td><td className="player-cell"><PlayerName name={m.playerB} selected={selectedPlayer} /></td><td><span className="cell-primary game-name">{m.game_name}</span><span className="cell-secondary">{m.fullName || m.groupName}</span></td></tr>)}</tbody></table></div>
          <div className="mobile-results">{matches.data.slice(start, start + PAGE_SIZE).map((m, i) => <article className="match-card" key={`${m.matchId || m.raceId}-${i}`}><div className="card-meta"><span>{m.matchTime || '时间待定'}<span className="meta-dot">·</span>{m.round || '轮次待定'}</span><OutcomeBadge outcome={getMatchOutcome(m, selectedPlayer)} /></div><div className="card-matchup"><div><span className="side-label">选手 A</span><PlayerName name={m.playerA} selected={selectedPlayer} /></div><div className="card-score"><strong>{m.score || '—'}</strong><span>原始比分</span></div><div><span className="side-label">选手 B</span><PlayerName name={m.playerB} selected={selectedPlayer} /></div></div><div className="card-event"><span>{m.game_name}</span><small>{m.fullName || m.groupName}</small></div></article>)}</div>
        </>}
        {hasResults && !isPlayer && <>
          <div className="desktop-results"><table className="data-table ranking-table"><thead><tr><th>名次</th><th>运动员 / 组合</th><th>俱乐部</th><th>积分</th><th>赛事 / 组别</th><th><span className="sr-only">查看战绩</span></th></tr></thead><tbody>{rankings.data.slice(start, start + PAGE_SIZE).map((r, i) => <tr key={`${r.raceId}-${i}`}><td><RankBadge rank={r.rank} /></td><td><button className="player-link" onClick={() => openPlayer(r.playerName)}>{r.playerName}</button></td><td>{r.club || '—'}</td><td className="numeric">{r.score ?? '—'}</td><td><span className="cell-primary game-name">{r.game_name}</span><span className="cell-secondary">{r.fullGroupName || r.groupName}</span></td><td><button className="icon-button" aria-label={`查看${r.playerName}的战绩`} onClick={() => openPlayer(r.playerName)}><ArrowUpRight size={18} /></button></td></tr>)}</tbody></table></div>
          <div className="mobile-results">{rankings.data.slice(start, start + PAGE_SIZE).map((r, i) => <article className="ranking-card" key={`${r.raceId}-${i}`}><div className="ranking-card-top"><RankBadge rank={r.rank} /><div><button className="player-link" onClick={() => openPlayer(r.playerName)}>{r.playerName}<ArrowUpRight size={14} /></button><span className="cell-secondary">{r.club || '俱乐部未提供'}</span></div><span className="rank-score"><strong>{r.score ?? '—'}</strong><small>积分</small></span></div><div className="card-event"><span>{r.game_name}</span><small>{r.fullGroupName || r.groupName}</small></div></article>)}</div>
        </>}

        {hasResults && <><div className="pagination"><span>共 {formatNumber(current.data.length)} 条<span className="pagination-range">，当前 {start + 1}–{Math.min(start + PAGE_SIZE, current.data.length)} 条</span></span><div><button className="icon-button" disabled={page <= 1} aria-label="上一页" onClick={() => changePage(page - 1)}><ChevronLeft size={18} /></button><span className="page-indicator">{page}<span> / {pages}</span></span><button className="icon-button" disabled={page >= pages} aria-label="下一页" onClick={() => changePage(page + 1)}><ChevronRight size={18} /></button></div></div><p className="results-footnote"><Users size={14} />{isPlayer ? '姓名查询可能包含同名运动员；请结合赛事、组别与组合确认。待确认记录不计入胜率。' : '名次与积分按赛事原始数据展示，不代表跨赛事的综合排名。'}</p></>}
      </section>
      <footer className="site-footer"><span>STAR <span className="footer-divider">/</span> 专注羽毛球比赛记录</span><button className="text-button" onClick={clearCache} disabled={loading}><RotateCcw size={13} />清除查询缓存</button></footer>
    </main>
    {notice && <div className="toast" role={notice.error ? 'alert' : 'status'}>{notice.error ? <CircleAlert size={16} /> : <Check size={16} />}{notice.message}</div>}
  </div>;
};
