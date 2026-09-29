import { DEFAULT_RULES, type GameState, type Move, type MoveRecord, type Piece, type PieceKind, type RuleConfig, type Side } from './types';
import { judgeWxfRepetition } from './wxf';

export function opposite(side: Side): Side { return side === 'red' ? 'black' : 'red'; }

const NAMES: Record<Side, Record<PieceKind, string>> = {
  red: { king: '帅', advisor: '仕', elephant: '相', horse: '马', rook: '车', cannon: '炮', pawn: '兵' },
  black: { king: '将', advisor: '士', elephant: '象', horse: '马', rook: '车', cannon: '炮', pawn: '卒' },
};
export function pieceLabel(piece: Pick<Piece, 'kind' | 'side'>): string { return NAMES[piece.side][piece.kind]; }

function inside(x: number, y: number): boolean { return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < 9 && y >= 0 && y < 10; }
function palace(side: Side, x: number, y: number): boolean { return x >= 3 && x <= 5 && (side === 'red' ? y >= 7 && y <= 9 : y >= 0 && y <= 2); }
function at(pieces: Piece[], x: number, y: number): Piece | undefined { return pieces.find(p => p.x === x && p.y === y); }
function sameMove(a: Move, b: Move): boolean { return a.from.x === b.from.x && a.from.y === b.from.y && a.to.x === b.to.x && a.to.y === b.to.y; }

function pseudoMoves(pieces: Piece[], piece: Piece): Move[] {
  const { x, y, side, kind } = piece;
  const result: Move[] = [];
  const add = (nx: number, ny: number) => {
    if (!inside(nx, ny)) return;
    const target = at(pieces, nx, ny);
    if (!target || target.side !== side) result.push({ from: { x, y }, to: { x: nx, y: ny } });
  };
  if (kind === 'rook' || kind === 'cannon') {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let nx = x + dx, ny = y + dy, screen = false;
      while (inside(nx, ny)) {
        const target = at(pieces, nx, ny);
        if (kind === 'rook') {
          if (!target) add(nx, ny);
          else { add(nx, ny); break; }
        } else if (!screen) {
          if (!target) add(nx, ny);
          else screen = true;
        } else if (target) {
          add(nx, ny);
          break;
        }
        nx += dx; ny += dy;
      }
    }
  } else if (kind === 'horse') {
    for (const [legX, legY, dx1, dy1, dx2, dy2] of [
      [1, 0, 2, 1, 2, -1], [-1, 0, -2, 1, -2, -1],
      [0, 1, 1, 2, -1, 2], [0, -1, 1, -2, -1, -2],
    ]) {
      if (!at(pieces, x + legX, y + legY)) { add(x + dx1, y + dy1); add(x + dx2, y + dy2); }
    }
  } else if (kind === 'elephant') {
    for (const [dx, dy] of [[2, 2], [2, -2], [-2, 2], [-2, -2]]) {
      const ny = y + dy;
      if ((side === 'red' ? ny >= 5 : ny <= 4) && !at(pieces, x + dx / 2, y + dy / 2)) add(x + dx, ny);
    }
  } else if (kind === 'advisor' || kind === 'king') {
    const dirs = kind === 'advisor' ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of dirs) if (palace(side, x + dx, y + dy)) add(x + dx, y + dy);
    if (kind === 'king') {
      const enemy = pieces.find(p => p.kind === 'king' && p.side !== side && p.x === x);
      if (enemy) {
        const lo = Math.min(y, enemy.y), hi = Math.max(y, enemy.y);
        if (!pieces.some(p => p.x === x && p.y > lo && p.y < hi)) add(enemy.x, enemy.y);
      }
    }
  } else {
    const forward = side === 'red' ? -1 : 1;
    add(x, y + forward);
    if (side === 'red' ? y <= 4 : y >= 5) { add(x - 1, y); add(x + 1, y); }
  }
  return result;
}

export function isInCheck(pieces: Piece[], side: Side): boolean {
  const king = pieces.find(p => p.side === side && p.kind === 'king');
  if (!king) return true;
  return pieces.some(p => p.side !== side && pseudoMoves(pieces, p).some(m => m.to.x === king.x && m.to.y === king.y));
}

function movedPieces(pieces: Piece[], move: Move): Piece[] {
  const moving = at(pieces, move.from.x, move.from.y)!;
  return pieces.filter(p => p.id !== moving.id && !(p.x === move.to.x && p.y === move.to.y))
    .concat({ ...moving, x: move.to.x, y: move.to.y });
}

export function getLegalMoves(state: GameState, pieceId?: string): Move[] {
  if (state.status !== 'playing') return [];
  const pieces = state.pieces;
  const movers = pieces.filter(p => p.side === state.turn && (!pieceId || p.id === pieceId));
  const legal: Move[] = [];
  for (const piece of movers) for (const move of pseudoMoves(pieces, piece)) {
    const target = at(pieces, move.to.x, move.to.y);
    if (target?.kind === 'king') continue;
    if (!isInCheck(movedPieces(pieces, move), state.turn)) legal.push(move);
  }
  return legal;
}

function key(pieces: Piece[], turn: Side): string {
  return `${turn}|${pieces.map(p => `${p.side[0]}${p.kind[0]}${p.x}${p.y}`).sort().join(',')}`;
}

function number(n: number, side: Side): string {
  return side === 'red' ? '一二三四五六七八九十'[n - 1] ?? String(n) : String(n);
}
function file(x: number, side: Side): string { return number(side === 'red' ? 9 - x : x + 1, side); }

function notation(pieces: Piece[], piece: Piece, move: Move): string {
  const sameFile = pieces.filter(p => p.side === piece.side && p.kind === piece.kind && p.x === piece.x);
  let head = pieceLabel(piece) + file(piece.x, piece.side);
  if (sameFile.length > 1) {
    const ordered = [...sameFile].sort((a, b) => piece.side === 'red' ? a.y - b.y : b.y - a.y);
    const rank = ordered.findIndex(p => p.id === piece.id);
    const prefix = sameFile.length === 2 ? (rank === 0 ? '前' : '后') : sameFile.length === 3 ? ['前', '中', '后'][rank] : number(rank + 1, piece.side);
    head = prefix + pieceLabel(piece);
  }
  const dy = move.to.y - move.from.y;
  const forward = piece.side === 'red' ? dy < 0 : dy > 0;
  const action = dy === 0 ? '平' : forward ? '进' : '退';
  const endpoint = dy === 0 || ['horse', 'elephant', 'advisor'].includes(piece.kind)
    ? file(move.to.x, piece.side) : number(Math.abs(dy), piece.side);
  return head + action + endpoint;
}

function repeatedVerdict(keys: string[], history: MoveRecord[], currentKey: string, rules: RuleConfig): Side | 'draw' | null {
  const matches: number[] = [];
  keys.forEach((k, i) => { if (k === currentKey) matches.push(i); });
  if (matches.length < 3) return null;
  if (rules.repetition === 'friendly') return 'draw';
  const [first, second, third] = matches.slice(-3);
  const cycles = [history.slice(first, second), history.slice(second, third)];
  for (const side of ['red', 'black'] as Side[]) {
    if (cycles.every(cycle => {
      const own = cycle.filter(m => m.piece.side === side);
      const other = cycle.filter(m => m.piece.side !== side);
      return own.length > 0 && own.every(m => m.check) && other.every(m => !m.check);
    })) return opposite(side);
  }
  return 'draw';
}

export function applyMove(state: GameState, move: Move): GameState {
  if (!inside(move.from.x, move.from.y) || !inside(move.to.x, move.to.y)) throw new Error('Invalid coordinates');
  if (!getLegalMoves(state).some(m => sameMove(m, move))) throw new Error('Illegal move');
  const piece = at(state.pieces, move.from.x, move.from.y)!;
  const captured = at(state.pieces, move.to.x, move.to.y);
  const nextPieces = movedPieces(state.pieces, move);
  const nextTurn = opposite(state.turn);
  const check = isInCheck(nextPieces, nextTurn);
  const record: MoveRecord = { from: { ...move.from }, to: { ...move.to }, piece: { ...piece },
    ...(captured ? { captured: { ...captured } } : {}), notation: notation(state.pieces, piece, move), check, ply: state.history.length + 1 };
  const history = [...state.history, record];
  const nextKey = key(nextPieces, nextTurn);
  const positionKeys = [...(state.positionKeys.length ? state.positionKeys : [key(state.pieces, state.turn)]), nextKey];
  const halfmoveClock = captured ? 0 : state.halfmoveClock + 1;
  const next: GameState = { pieces: nextPieces, turn: nextTurn, status: 'playing', winner: null, reason: null,
    history, positionKeys, halfmoveClock, rules: { ...state.rules }, check: check ? nextTurn : null, repetitionWarning: null };
  if (getLegalMoves(next).length === 0) {
    next.status = 'finished'; next.winner = state.turn; next.reason = check ? 'checkmate' : 'stalemate';
  } else {
    const wxf = next.rules.repetition === 'wxf'
      ? judgeWxfRepetition(nextPieces, history, positionKeys, { pseudo: pseudoMoves, move: movedPieces, checked: isInCheck }) : null;
    const repetition = wxf ? wxf.winner : repeatedVerdict(positionKeys, history, nextKey, next.rules);
    next.repetitionWarning = wxf?.warning ?? null;
    if (repetition !== null) {
      next.status = 'finished'; next.winner = repetition; next.reason = wxf?.reason ?? (repetition === 'draw' ? 'repetition' : 'perpetual-check');
    } else if (next.rules.noCaptureLimit > 0 && halfmoveClock >= next.rules.noCaptureLimit) {
      next.status = 'finished'; next.winner = 'draw'; next.reason = 'no-capture';
    }
  }
  return next;
}

export function createGame(rules: Partial<RuleConfig> = {}): GameState {
  const config = { ...DEFAULT_RULES, ...rules };
  if (!['wxf', 'friendly', 'check-loss'].includes(config.repetition) || !Number.isInteger(config.noCaptureLimit) || config.noCaptureLimit < 0) throw new Error('Invalid rules');
  const pieces: Piece[] = [];
  const add = (side: Side, kind: PieceKind, x: number, y: number) => pieces.push({ id: `${side}-${kind}-${x}-${y}`, side, kind, x, y });
  for (const side of ['black', 'red'] as Side[]) {
    const home = side === 'red' ? 9 : 0, cannon = side === 'red' ? 7 : 2, pawn = side === 'red' ? 6 : 3;
    const back: PieceKind[] = ['rook', 'horse', 'elephant', 'advisor', 'king', 'advisor', 'elephant', 'horse', 'rook'];
    back.forEach((kind, x) => add(side, kind, x, home));
    for (const x of [1, 7]) add(side, 'cannon', x, cannon);
    for (const x of [0, 2, 4, 6, 8]) add(side, 'pawn', x, pawn);
  }
  return { pieces, turn: 'red', status: 'playing', winner: null, reason: null, history: [],
    positionKeys: [key(pieces, 'red')], halfmoveClock: 0, rules: config, check: null, repetitionWarning: null };
}
