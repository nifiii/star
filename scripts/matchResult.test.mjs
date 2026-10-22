import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Use the project's compiler so these tests also run in the existing Node 20 image.
const source = readFileSync(new URL('../services/matchResult.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } });
const { getMatchOutcome } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));

const match = (score, playerA = '林星 / 陈羽', playerB = '李晨 / 周云') => ({ playerA, playerB, score });

test('single games and doubles use the selected side, not the score display order', () => {
  assert.equal(getMatchOutcome(match('21:15'), '林星'), 'win');
  assert.equal(getMatchOutcome(match('21:15'), '李晨'), 'loss');
  assert.equal(getMatchOutcome(match('18:21'), '林 星'), 'loss');
  assert.equal(getMatchOutcome(match('2:0'), '林星'), 'win');
});

test('multi-game scores compare games won and preserve the original score', () => {
  const record = match('21:15, 18:21, 21:19');
  assert.equal(getMatchOutcome(record, '林星'), 'win');
  assert.equal(getMatchOutcome(record, '李晨'), 'loss');
  assert.equal(record.score, '21:15, 18:21, 21:19');
  assert.equal(getMatchOutcome(match('21：18；21：19'), '林星'), 'win');
});

test('unfinished, missing, equal and exceptional scores are pending', () => {
  for (const score of ['0:0', '', undefined, '弃权', '21:0 退赛', '21:21', '21:19,19:21', '21:18,0:0', '21:15, invalid']) {
    assert.equal(getMatchOutcome(match(score), '林星'), 'pending', String(score));
  }
});

test('ambiguous and absent player names cannot produce a win or loss', () => {
  assert.equal(getMatchOutcome(match('21:15', '林星', '林星宇'), '林星'), 'pending');
  assert.equal(getMatchOutcome(match('21:15'), '未参赛'), 'pending');
  assert.equal(getMatchOutcome(match('21:15'), ''), 'pending');
});
