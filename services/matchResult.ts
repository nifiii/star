import type { MatchScoreResult } from '../types';

export type MatchOutcome = 'win' | 'loss' | 'pending';
export const normalizeName = (name: string) => name.replace(/\s+/g, '').toLocaleLowerCase();

export function getMatchOutcome(match: MatchScoreResult, playerName: string): MatchOutcome {
  const target = normalizeName(playerName);
  const isA = !!target && normalizeName(match.playerA || '').includes(target);
  const isB = !!target && normalizeName(match.playerB || '').includes(target);
  const raw = (match.score || '').trim();
  // Equal scores, unfinished games, ambiguous names and walkover text must not inflate win rates.
  if (isA === isB || !/^\d+\s*[:：]\s*\d+(?:[\s,，;；/、]+\d+\s*[:：]\s*\d+)*$/.test(raw)) return 'pending';
  const games = Array.from(raw.matchAll(/(\d+)\s*[:：]\s*(\d+)/g), m => [Number(m[1]), Number(m[2])]);
  if (games.some(([a, b]) => a === b)) return 'pending';
  const aWins = games.filter(([a, b]) => a > b).length;
  const bWins = games.length - aWins;
  if (aWins === bWins) return 'pending';
  return (isA ? aWins > bWins : bWins > aWins) ? 'win' : 'loss';
}
