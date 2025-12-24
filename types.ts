
export interface ApiHeaderConfig {
  token: string;
  sn: string;
  snTime: number;
  uv?: string;
}

export interface UserCredentials {
  username?: string;
  password?: string;
  isLoggedIn: boolean;
  lastLoginTime?: number;
}

export interface SearchConfig {
  // birthYear removed
  province: string; // e.g. "广东省"
  city: string;     // e.g. "广州市"
  gameKeywords: string; // e.g. "少年,小学" -> regex OR logic
  
  // Split group filtering
  uKeywords: string; // U-series (OR logic), e.g. "U8,U9"
  levelKeywords: string; // Level/School (AND logic), e.g. "小学,乙"
  
  itemKeywords: string; // Comma separated, e.g. "男单"
  targetPlayerName?: string; // New: For direct search
  playerGender?: 'M' | 'F' | null; // New: Gender filter for player search
}

export interface GameBasicInfo {
  id: string; // raceId
  game_name: string;
  start_date?: string;
}

export interface MatchItem {
  id: string; // itemId
  raceId: string;
  game_name: string;
  groupName: string;
  itemType: string; 
}

export interface PlayerRank {
  raceId: string;
  game_name: string;
  groupName: string; // Specific group name e.g. "U8 男单 A组"
  playerName: string;
  rank: number | string;
  score?: number; // Integral score
  club?: string;
}

export interface MatchScoreResult {
  raceId: string;
  game_name: string;
  groupName: string;
  itemType?: string;
  matchId?: string;
  playerA: string;
  playerB: string;
  score: string;
  matchTime?: string;
  round?: string;
}

export interface DataCache<T> {
  data: T;
  timestamp: number;
  key: string;
}

export enum StepStatus {
  IDLE = 'idle',
  LOADING = 'loading',
  COMPLETE = 'complete',
  ERROR = 'error'
}

export interface LogEntry {
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'error';
}

export type AppView = 'DASHBOARD_RANKS' | 'PLAYER_HISTORY';
