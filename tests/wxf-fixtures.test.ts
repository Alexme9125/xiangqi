import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyMove, createGame, getLegalMoves, isInCheck } from '../shared/engine';
import type { GameState, Move, Piece, PieceKind, Side } from '../shared/types';

interface SourceCase {
  id: string;
  sourceLine: number;
  diagramHint: string | null;
  fen: string;
  moves: string[];
  sourceJudgment: 'win' | 'loss' | 'draw' | 'undecided';
  expectedWinner: Side | 'draw' | null;
}
const data = JSON.parse(readFileSync(new URL('./fixtures/wxf-cases.json', import.meta.url), 'utf8')) as { cases: SourceCase[] };
const kinds: Record<string, PieceKind> = {
  k: 'king', a: 'advisor', b: 'elephant', e: 'elephant', n: 'horse', h: 'horse',
  r: 'rook', c: 'cannon', p: 'pawn',
};

function fromFen(fen: string): GameState {
  const [placement, active] = fen.split(/\s+/);
  assert.ok(active === 'w' || active === 'b', `bad active side in ${fen}`);
  const pieces: Piece[] = [];
  const rows = placement.split('/');
  assert.equal(rows.length, 10, `bad FEN row count in ${fen}`);
  for (let y = 0; y < rows.length; y++) {
    let x = 0;
    for (const char of rows[y]) {
      if (/^[1-9]$/.test(char)) { x += Number(char); continue; }
      const kind = kinds[char.toLowerCase()];
      assert.ok(kind, `unknown FEN piece ${char}`);
      const side = char === char.toUpperCase() ? 'red' : 'black';
      pieces.push({ id: `${side}-${kind}-${x}-${y}`, side, kind, x, y });
      x++;
    }
    assert.equal(x, 9, `bad FEN row width in ${fen}`);
  }
  const turn: Side = active === 'w' ? 'red' : 'black';
  assert.equal(pieces.filter(p => p.kind === 'king' && p.side === 'red').length, 1);
  assert.equal(pieces.filter(p => p.kind === 'king' && p.side === 'black').length, 1);
  return { ...createGame({ repetition: 'wxf', noCaptureLimit: 0 }), pieces, turn, history: [],
    positionKeys: [], check: isInCheck(pieces, turn) ? turn : null };
}

function iccs(s: string): Move {
  assert.match(s, /^[a-i][0-9][a-i][0-9]$/);
  const point = (file: string, rank: string) => ({ x: file.charCodeAt(0) - 97, y: 9 - Number(rank) });
  return { from: point(s[0], s[1]), to: point(s[2], s[3]) };
}

function boardKey(state: GameState): string {
  return `${state.turn}|${state.pieces.map(p => `${p.side}:${p.kind}:${p.x}:${p.y}`).sort().join('|')}`;
}

function isLegal(state: GameState, move: Move): boolean {
  return getLegalMoves({ ...state, status: 'playing' }).some(m => m.from.x === move.from.x && m.from.y === move.from.y
    && m.to.x === move.to.x && m.to.y === move.to.y);
}

// Factual move replay for source verification. A new state drops adjudication history so
// long published examples remain replayable even if a rule has already ended the match.
function replaySource(source: SourceCase): { state: GameState; keys: string[] } {
  let state = fromFen(source.fen);
  const keys = [boardKey(state)];
  for (const encoded of source.moves) {
    const move = iccs(encoded);
    assert.ok(isLegal(state, move), `${source.id} line ${source.sourceLine}: illegal source move ${encoded}`);
    state = applyMove({ ...state, status: 'playing', winner: null, reason: null,
      history: [], positionKeys: [], halfmoveClock: 0 }, move);
    keys.push(boardKey(state));
  }
  return { state, keys };
}

test('all 173 sourced FEN and ICCS rows are parseable and legal', () => {
  assert.equal(data.cases.length, 173);
  for (const source of data.cases) {
    const { state } = replaySource(source);
    const finalSide = state.turn;
    const expected = source.sourceJudgment === 'win' ? finalSide
      : source.sourceJudgment === 'loss' ? (finalSide === 'red' ? 'black' : 'red')
        : source.sourceJudgment === 'draw' ? 'draw' : null;
    assert.equal(source.expectedWinner, expected, `${source.id}: source judgment orientation`);
  }
});

test('WXF 39–41 keeps the attacker as a current cannon screen when classifying protection', () => {
  const source = data.cases.find(c => c.id === 'orange-056')!;
  const cycle = source.moves.slice(0, 4);
  let state = fromFen(source.fen);
  for (const encoded of [...cycle, ...cycle, ...cycle, ...cycle]) {
    if (state.status === 'finished') break;
    state = applyMove(state, iccs(encoded));
  }
  assert.equal(state.winner, 'black');
  assert.equal(state.reason, 'perpetual-chase');
  // Recomputing sliding rays only after the hypothetical capture incorrectly
  // removes the black rook's role as a screen and changes this to a draw.
});

test('WXF current sliding protection preserves the permitted alternating double-rook cycle', () => {
  const source = data.cases.find(c => c.id === 'orange-107')!;
  const cycle = source.moves.slice(0, 8);
  let state = fromFen(source.fen);
  for (const encoded of [...cycle, ...cycle, ...cycle, ...cycle]) {
    if (state.status === 'finished') break;
    state = applyMove(state, iccs(encoded));
  }
  assert.equal(state.winner, 'draw');
  assert.equal(state.reason, 'repetition');
  // The same post-capture-ray substitution incorrectly charges red with a
  // perpetual chase here. This guards the opposite direction of misjudgment.
});

test('published WXF repetition cycles reach their factual winner on continued play', () => {
  const failures: string[] = [];
  let exercised = 0;
  for (const source of data.cases) {
    if (source.expectedWinner === null) continue;
    const { keys } = replaySource(source);
    const matches = keys.slice(0, -1).flatMap((key, index) => key === keys[keys.length - 1] ? [index] : []);
    // Retain two published return paths when present. Diagram 80 alternates
    // which cannon is chased across those paths; repeating only the last one
    // changes the factual pattern and its WXF ruling.
    const previous = matches.length > 1 ? matches[matches.length - 2] : (matches[0] ?? -1);
    if (previous < 0) {
      // Source case orange-120 reaches a new final position and offers no final cycle.
      // Its FEN and listed moves are checked above, but no continued ruling is inferred.
      assert.equal(source.id, 'orange-120');
      continue;
    }
    exercised++;
    const cycle = source.moves.slice(previous);
    let state = fromFen(source.fen);
    const continuation = [...source.moves, ...cycle, ...cycle, ...cycle, ...cycle];
    try {
      for (const encoded of continuation) {
        if (state.status === 'finished') break;
        const move = iccs(encoded);
        assert.ok(isLegal(state, move), `illegal ${encoded}`);
        state = applyMove(state, move);
      }
      if (state.status !== 'finished' || state.winner !== source.expectedWinner) {
        failures.push(`${source.id} (line ${source.sourceLine}, diagram ${source.diagramHint ?? '?'}): expected ${source.expectedWinner}, got ${state.status}/${state.winner}/${state.reason}`);
      }
    } catch (error) {
      failures.push(`${source.id} (line ${source.sourceLine}): ${String(error)}`);
    }
  }
  assert.equal(exercised, 170);
  assert.deepEqual(failures, [], `${failures.length} WXF fixture mismatches:\n${failures.join('\n')}`);
});
