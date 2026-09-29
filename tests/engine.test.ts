import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, createGame, getLegalMoves, isInCheck, pieceLabel } from '../shared/engine';
import type { GameState, Move, Piece, PieceKind, Side } from '../shared/types';

const p = (id: string, side: Side, kind: PieceKind, x: number, y: number): Piece => ({ id, side, kind, x, y });
const m = (x: number, y: number, tx: number, ty: number): Move => ({ from: { x, y }, to: { x: tx, y: ty } });
const includes = (moves: Move[], move: Move) => moves.some(v => JSON.stringify(v) === JSON.stringify(move));
function board(pieces: Piece[], turn: Side = 'red', rules: Partial<GameState['rules']> = {}): GameState {
  return { ...createGame(rules), pieces, turn, history: [], positionKeys: [], check: isInCheck(pieces, turn) ? turn : null };
}
const kings = [p('rk', 'red', 'king', 4, 9), p('bk', 'black', 'king', 4, 0), p('block', 'red', 'pawn', 4, 5)];

test('initial setup is stable and applyMove is immutable', () => {
  const start = createGame();
  assert.equal(start.pieces.length, 32);
  assert.equal(start.turn, 'red');
  assert.ok(getLegalMoves(start).length > 30);
  const pawn = start.pieces.find(v => v.side === 'red' && v.kind === 'pawn' && v.x === 0)!;
  const next = applyMove(start, m(0, 6, 0, 5));
  assert.equal(start.pieces.find(v => v.id === pawn.id)?.y, 6);
  assert.equal(next.pieces.find(v => v.id === pawn.id)?.y, 5);
  assert.equal(next.history[0].notation, '兵九进一');
  assert.equal(next.positionKeys.length, 2);
  assert.equal(next.halfmoveClock, 1);
  assert.throws(() => applyMove(start, m(0, 6, 0, 4)), /Illegal/);
});

test('horse leg, elephant eye and river, and cannon screen', () => {
  const horse = p('h', 'red', 'horse', 4, 6);
  const horseBoard = board([...kings, horse, p('leg', 'red', 'pawn', 4, 7)]);
  assert.ok(!includes(getLegalMoves(horseBoard, 'h'), m(4, 6, 3, 8)));
  assert.ok(includes(getLegalMoves(horseBoard, 'h'), m(4, 6, 6, 5)));

  const elephant = p('e', 'red', 'elephant', 2, 7);
  const elephantBoard = board([...kings, elephant, p('eye', 'black', 'pawn', 3, 6)]);
  assert.ok(!includes(getLegalMoves(elephantBoard, 'e'), m(2, 7, 4, 5)));
  assert.ok(!includes(getLegalMoves(board([...kings, p('e', 'red', 'elephant', 2, 5)]), 'e'), m(2, 5, 4, 3)));

  const cannon = p('c', 'red', 'cannon', 0, 7);
  const cannonBoard = board([...kings, cannon, p('screen', 'red', 'pawn', 0, 5), p('target', 'black', 'rook', 0, 2)]);
  assert.ok(includes(getLegalMoves(cannonBoard, 'c'), m(0, 7, 0, 2)));
  assert.ok(!includes(getLegalMoves(cannonBoard, 'c'), m(0, 7, 0, 4)));
  assert.ok(!includes(getLegalMoves(board([...kings, cannon, p('target', 'black', 'rook', 0, 2)]), 'c'), m(0, 7, 0, 2)));
});

test('palace, pawn crossing, pin, and facing kings', () => {
  const advisor = p('a', 'red', 'advisor', 4, 8);
  assert.ok(includes(getLegalMoves(board([...kings, advisor]), 'a'), m(4, 8, 3, 7)));
  assert.ok(!includes(getLegalMoves(board([...kings, p('edge', 'red', 'advisor', 3, 7)]), 'edge'), m(3, 7, 2, 6)));
  const pawn = p('x', 'red', 'pawn', 0, 5);
  assert.ok(!includes(getLegalMoves(board([...kings, pawn]), 'x'), m(0, 5, 1, 5)));
  const crossed = board([...kings, { ...pawn, y: 4 }]);
  assert.ok(includes(getLegalMoves(crossed, 'x'), m(0, 4, 1, 4)));
  const pin = board([p('rk', 'red', 'king', 4, 9), p('bk', 'black', 'king', 4, 0), p('shield', 'red', 'rook', 4, 5)]);
  assert.ok(!includes(getLegalMoves(pin, 'shield'), m(4, 5, 3, 5)));
  assert.ok(isInCheck([p('rk', 'red', 'king', 4, 9), p('bk', 'black', 'king', 4, 0)], 'red'));
  assert.equal(pieceLabel({ side: 'black', kind: 'king' }), '将');
});

test('checkmate, stalemate loss, capture clock and no-capture draw', () => {
  const mate = board([...kings, p('l', 'red', 'rook', 3, 1), p('r', 'red', 'rook', 5, 1), p('fin', 'red', 'rook', 0, 2)]);
  const finish = applyMove(mate, m(0, 2, 4, 2));
  assert.equal(finish.status, 'finished');
  assert.equal(finish.winner, 'red');
  assert.equal(finish.reason, 'checkmate');
  const stale = board([...kings, p('l', 'red', 'rook', 3, 1), p('r', 'red', 'rook', 5, 1), p('p', 'red', 'pawn', 0, 6)]);
  const lost = applyMove(stale, m(0, 6, 0, 5));
  assert.equal(lost.winner, 'red');
  assert.equal(lost.reason, 'stalemate');

  const clock = board([...kings, p('a', 'red', 'rook', 0, 7), p('v', 'black', 'pawn', 0, 6)], 'red', { noCaptureLimit: 2 });
  clock.halfmoveClock = 1;
  assert.equal(applyMove(clock, m(0, 7, 0, 6)).halfmoveClock, 0);
  const quiet = board([...kings, p('a', 'red', 'rook', 0, 7)], 'red', { noCaptureLimit: 2 });
  quiet.halfmoveClock = 1;
  assert.equal(applyMove(quiet, m(0, 7, 0, 6)).reason, 'no-capture');
});

test('threefold draws under friendly policy and perpetual checking loses under check-loss', () => {
  let friendly = board([...kings, p('rr', 'red', 'rook', 0, 9), p('br', 'black', 'rook', 8, 0)], 'red', { repetition: 'friendly' });
  const cycle = [m(0, 9, 0, 8), m(8, 0, 8, 1), m(0, 8, 0, 9), m(8, 1, 8, 0)];
  for (const move of cycle) friendly = applyMove(friendly, move);
  assert.equal(friendly.status, 'playing', 'the second occurrence is not threefold');
  for (const move of cycle) friendly = applyMove(friendly, move);
  assert.equal(friendly.winner, 'draw');
  assert.equal(friendly.reason, 'repetition');

  let neutral = board([...kings, p('rr', 'red', 'rook', 0, 9), p('br', 'black', 'rook', 8, 0)], 'red', { repetition: 'check-loss' });
  for (const move of [...cycle, ...cycle]) neutral = applyMove(neutral, move);
  assert.equal(neutral.winner, 'draw');
  assert.equal(neutral.reason, 'repetition');

  let chase = board([...kings, p('checker', 'red', 'rook', 4, 2)], 'black', { repetition: 'check-loss' });
  const checks = [m(4, 0, 5, 0), m(4, 2, 5, 2), m(5, 0, 4, 0), m(5, 2, 4, 2)];
  for (const move of [...checks, ...checks]) chase = applyMove(chase, move);
  assert.equal(chase.winner, 'black');
  assert.equal(chase.reason, 'perpetual-check');
  assert.equal(chase.history.filter(v => v.piece.side === 'red').every(v => v.check), true);
});

test('position keys ignore IDs but distinguish piece kind and side to move', () => {
  const redRook = board([...kings, p('extra', 'red', 'rook', 0, 7)]);
  const renamed = board([...kings.map(v => ({ ...v, id: `new-${v.id}` })), p('renamed', 'red', 'rook', 0, 7)]);
  const redHorse = board([...kings, p('extra', 'red', 'horse', 0, 7)]);
  const step = m(0, 7, 0, 6);
  const first = applyMove(redRook, step);
  assert.equal(first.positionKeys[0], applyMove(renamed, step).positionKeys[0]);
  assert.notEqual(first.positionKeys[0], applyMove(redHorse, m(0, 7, 2, 6)).positionKeys[0]);
  const blackTurn = board([...kings, p('extra', 'red', 'rook', 0, 7)], 'black');
  assert.notEqual(first.positionKeys[0], applyMove(blackTurn, m(4, 0, 3, 0)).positionKeys[0]);
});

test('WXF warns after three complete checking cycles, permits a change, and loses on continued repetition', () => {
  let state = board([...kings, p('checker', 'red', 'rook', 4, 2)], 'black', { repetition: 'wxf', noCaptureLimit: 0 });
  const cycle = [m(4, 0, 5, 0), m(4, 2, 5, 2), m(5, 0, 4, 0), m(5, 2, 4, 2)];
  for (const move of [...cycle, ...cycle]) state = applyMove(state, move);
  assert.equal(state.status, 'playing');
  assert.equal(state.repetitionWarning, null);
  for (const move of cycle) state = applyMove(state, move);
  assert.equal(state.status, 'playing');
  assert.deepEqual(state.repetitionWarning, { side: 'red', kind: 'check' });
  const evaded = applyMove(state, cycle[0]);
  const changed = applyMove(evaded, m(4, 2, 2, 2));
  assert.equal(changed.status, 'playing');
  assert.equal(changed.repetitionWarning, null, 'a legal change must clear the warning');
  for (const move of cycle) state = applyMove(state, move);
  assert.equal(state.winner, 'black');
  assert.equal(state.reason, 'perpetual-check');
});

test('WXF neutral repetition draws after four cycles and the confirmed default capture clock is 100 plies', () => {
  let state = board([...kings, p('rr', 'red', 'rook', 0, 9), p('br', 'black', 'rook', 8, 0)], 'red');
  const cycle = [m(0, 9, 0, 8), m(8, 0, 8, 1), m(0, 8, 0, 9), m(8, 1, 8, 0)];
  for (const move of [...cycle, ...cycle, ...cycle]) state = applyMove(state, move);
  assert.equal(state.status, 'playing');
  assert.equal(state.repetitionWarning, null);
  for (const move of cycle) state = applyMove(state, move);
  assert.equal(state.winner, 'draw');
  assert.equal(state.reason, 'repetition');
  const beforeLimit = { ...createGame(), halfmoveClock: 98 };
  assert.equal(beforeLimit.rules.noCaptureLimit, 100);
  assert.equal(beforeLimit.rules.repetition, 'wxf');
  const step99 = applyMove(beforeLimit, m(0, 6, 0, 5));
  assert.equal(step99.status, 'playing');
  const step100 = applyMove(step99, m(0, 3, 0, 4));
  assert.equal(step100.winner, 'draw');
  assert.equal(step100.reason, 'no-capture');
});
