import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseMove } from '../shared/ai';
import { applyMove, createGame, getLegalMoves } from '../shared/engine';
import type { GameState, Piece, PieceKind, Side } from '../shared/types';

const p = (id: string, side: Side, kind: PieceKind, x: number, y: number): Piece => ({ id, side, kind, x, y });
const moveKey = (move: NonNullable<ReturnType<typeof chooseMove>['move']>) => `${move.from.x},${move.from.y}:${move.to.x},${move.to.y}`;
function board(pieces: Piece[]): GameState { return { ...createGame(), pieces, positionKeys: [] }; }
const kings = [p('rk', 'red', 'king', 4, 9), p('bk', 'black', 'king', 4, 0), p('block', 'red', 'pawn', 4, 5)];

test('all personalities return a legal move and use the same requested budget', () => {
  const state = createGame();
  const legal = new Set(getLegalMoves(state).map(moveKey));
  for (const personality of ['cautious', 'balanced', 'aggressive'] as const) {
    const result = chooseMove(state, personality, 40);
    assert.ok(result.move);
    assert.ok(legal.has(moveKey(result.move!)));
    assert.ok(result.nodes > 0);
  }
});

test('AI finds an immediate checkmate', () => {
  const state = board([...kings, p('left', 'red', 'rook', 3, 1), p('right', 'red', 'rook', 5, 1), p('finisher', 'red', 'rook', 0, 2)]);
  const answer = chooseMove(state, 'balanced', 500);
  assert.ok(answer.move);
  const next = applyMove(state, answer.move!);
  assert.equal(next.winner, 'red');
  assert.equal(next.reason, 'checkmate');
});

test('AI takes a free rook at shallow depth', () => {
  const state = board([...kings, p('attacker', 'red', 'rook', 0, 5), p('victim', 'black', 'rook', 0, 3)]);
  const answer = chooseMove(state, 'aggressive', 250);
  assert.ok(answer.move);
  assert.equal(moveKey(answer.move!), '0,5:0,3');
});
