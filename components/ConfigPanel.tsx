import React, { useState } from 'react';
import { Search, SlidersHorizontal, ChevronDown, RotateCcw, LoaderCircle } from 'lucide-react';
import type { AppView, SearchConfig } from '../types';

interface Props {
  view: AppView;
  searchConfig: SearchConfig;
  loading: boolean;
  onChange: (key: keyof SearchConfig, value: string | null) => void;
  onSubmit: () => void;
  onReset: () => void;
}

const CITIES = ['广州市', '深圳市', '珠海市', '汕头市', '佛山市', '韶关市', '湛江市', '肇庆市', '江门市', '茂名市', '惠州市', '梅州市', '汕尾市', '河源市', '阳江市', '清远市', '东莞市', '中山市', '潮州市', '揭阳市', '云浮市'];
const GROUPS = [
  { field: 'uKeywords', label: '年龄组别 · 可多选', values: ['U7', 'U8', 'U9', 'U10', 'U11', 'U12', 'U13', 'U14', 'U15', 'U16'] },
  { field: 'levelKeywords', label: '学段 / 级别 · 可多选', values: ['儿童', '小学', '少年', '初中', '高中', '公开', '甲', '乙', '丙'] },
] as const;
// Preserve the existing API keyword mapping; matching rules are outside this visual redesign.
const ITEMS = [
  { label: '男单', value: '男单,男子单打,男子,单打,男A,男B' },
  { label: '女单', value: '女单,女子单打,女子,单打,女A,女B' },
  { label: '男双', value: '男双,男子双打,男子,双打' },
  { label: '女双', value: '女双,女子双打,女子,双打' },
  { label: '混双', value: '混双,混合双打,混合,双打' },
  { label: '团体', value: '团体' },
];

export default function ConfigPanel({ view, searchConfig: c, loading, onChange, onSubmit, onReset }: Props) {
  const [advanced, setAdvanced] = useState(false);
  const [validation, setValidation] = useState('');
  const isPlayer = view === 'PLAYER_HISTORY';
  const active = (field: 'uKeywords' | 'levelKeywords' | 'itemKeywords', value: string) => {
    const parts = (c[field] || '').split(/[,，]/).map(s => s.trim());
    return value.split(',').every(p => parts.includes(p)) || c[field] === value.split(',')[0];
  };
  const toggle = (field: 'uKeywords' | 'levelKeywords' | 'itemKeywords', value: string) => {
    const parts = new Set((c[field] || '').split(/[,，]/).map(s => s.trim()).filter(Boolean));
    const selected = active(field, value);
    value.split(',').forEach(p => selected ? parts.delete(p) : parts.add(p));
    onChange(field, Array.from(parts).join(','));
  };
  const itemLabel = ITEMS.filter(i => active('itemKeywords', i.value)).map(i => i.label).join('、') || c.itemKeywords || '全部项目';

  return <section className="search-panel" aria-label="查询条件">
    <form onSubmit={e => {
      e.preventDefault();
      if (isPlayer && !c.targetPlayerName?.trim()) {
        setValidation('请输入运动员姓名');
        document.getElementById('player-name')?.focus();
        return;
      }
      setValidation('');
      onSubmit();
    }}>
      <fieldset disabled={loading} className="search-fields">
        <div className="search-grid">
          <div className="field field-name">
            <label htmlFor="player-name">运动员姓名 {!isPlayer && <span className="optional">选填</span>}</label>
            <div className="input-icon"><Search size={17} aria-hidden="true" /><input id="player-name" value={c.targetPlayerName || ''} onChange={e => { onChange('targetPlayerName', e.target.value); setValidation(''); }} placeholder={isPlayer ? '输入姓名，查找比赛记录' : '输入姓名筛选成绩'} autoComplete="off" maxLength={80} aria-invalid={!!validation} aria-describedby={validation ? 'name-error' : undefined} /></div>
            {validation && <span className="field-error" id="name-error" role="alert">{validation}</span>}
          </div>
          <div className="field"><label htmlFor="city">比赛城市</label><select id="city" value={c.city} onChange={e => onChange('city', e.target.value)}><option value="">广东省 · 全部城市</option>{CITIES.map(city => <option key={city}>{city}</option>)}</select></div>
          <div className="field field-keyword"><label htmlFor="game-keyword">赛事关键词 <span className="optional">选填</span></label><input id="game-keyword" value={c.gameKeywords} onChange={e => onChange('gameKeywords', e.target.value)} placeholder="如：公开赛、青少年" /></div>
          <div className="field field-gender"><label htmlFor="gender">性别</label><select id="gender" value={c.playerGender || ''} onChange={e => onChange('playerGender', e.target.value || null)}><option value="">不限</option><option value="M">男子</option><option value="F">女子</option></select></div>
          <button type="submit" className="button button-primary search-submit">{loading ? <LoaderCircle size={18} className="spin" /> : <Search size={18} />}{loading ? '查询中' : isPlayer ? '查询战绩' : '查询成绩'}</button>
        </div>
        <div className="search-bottom">
          {isPlayer ? <p>支持姓名包含匹配，双打可输入其中一位运动员的姓名。</p> : <button type="button" className="filter-toggle" aria-expanded={advanced} aria-controls="rank-filters" onClick={() => setAdvanced(!advanced)}><SlidersHorizontal size={15} />组别与项目<span className="filter-summary">{[c.uKeywords, c.levelKeywords, itemLabel].filter(Boolean).join(' · ')}</span><ChevronDown size={15} className={advanced ? 'rotate' : ''} /></button>}
          <button type="button" className="text-button reset-button" onClick={() => { onReset(); setValidation(''); }}><RotateCcw size={14} />重置筛选</button>
        </div>
        {!isPlayer && advanced && <div id="rank-filters" className="advanced-filters">
          {GROUPS.map(group => <div className="chip-field" key={group.field}><span className="field-label">{group.label}</span><div className="chip-list">{group.values.map(value => <button type="button" key={value} aria-pressed={active(group.field, value)} className={`filter-chip ${active(group.field, value) ? 'active' : ''}`} onClick={() => toggle(group.field, value)}>{value}</button>)}</div></div>)}
          <div className="chip-field"><span className="field-label">比赛项目 · 可多选</span><div className="chip-list">{ITEMS.map(i => <button type="button" key={i.label} aria-pressed={active('itemKeywords', i.value)} className={`filter-chip ${active('itemKeywords', i.value) ? 'active' : ''}`} onClick={() => toggle('itemKeywords', i.value)}>{i.label}</button>)}<button type="button" className="text-button" onClick={() => { onChange('uKeywords', ''); onChange('levelKeywords', ''); onChange('itemKeywords', ''); }}>清空组别与项目</button></div></div>
        </div>}
      </fieldset>
    </form>
  </section>;
}
