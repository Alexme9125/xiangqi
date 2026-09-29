import { applyMove, getLegalMoves } from './engine';
import type { GameState, Move, Personality, Piece, PieceKind, Side } from './types';

export interface Choice { move: Move | null; depth: number; nodes: number; score: number }
const BASE: Record<PieceKind, number> = { king: 10000, rook: 950, cannon: 460, horse: 420, elephant: 205, advisor: 205, pawn: 105 };
const MATE = 100000;
const TIMEOUT = Symbol('search timeout');

function at(state: GameState, x: number, y: number): Piece | undefined { return state.pieces.find(p => p.x === x && p.y === y); }
function signature(move: Move): string { return `${move.from.x}${move.from.y}${move.to.x}${move.to.y}`; }

function movePriority(state: GameState, move: Move, principal?: Move): number {
  if (principal && signature(principal) === signature(move)) return 100000;
  const victim = at(state, move.to.x, move.to.y);
  if (!victim) return 0;
  const actor = at(state, move.from.x, move.from.y)!;
  return 2000 + BASE[victim.kind] * 10 - BASE[actor.kind];
}

function ordered(state: GameState, moves: Move[], principal?: Move): Move[] {
  return moves.slice().sort((a, b) => movePriority(state, b, principal) - movePriority(state, a, principal));
}

function value(piece: Piece, personality: Personality): number {
  const advanced = piece.side === 'red' ? 9 - piece.y : piece.y;
  const center = 4 - Math.abs(4 - piece.x);
  const river = advanced >= 5;
  let bonus = 0;
  if (piece.kind === 'pawn') bonus = advanced * (personality === 'aggressive' ? 19 : personality === 'cautious' ? 11 : 15) + (river ? center * 8 : 0);
  if (piece.kind === 'horse') bonus = center * 9 + (advanced >= 2 && advanced <= 7 ? 15 : 0);
  if (piece.kind === 'cannon') bonus = center * 5 + (advanced >= 2 && advanced <= 7 ? 10 : 0);
  if (piece.kind === 'rook') bonus = center * 5 + advanced * (personality === 'aggressive' ? 4 : 2);
  if (piece.kind === 'king') bonus = personality === 'cautious' ? (advanced <= 1 ? 25 : -15) : 0;
  if (piece.kind === 'advisor' || piece.kind === 'elephant') bonus = personality === 'cautious' ? 35 : personality === 'aggressive' ? -8 : 12;
  const style = personality === 'aggressive' && (piece.kind === 'rook' || piece.kind === 'cannon' || piece.kind === 'horse') ? 25 : 0;
  return BASE[piece.kind] + bonus + style;
}

function evaluate(state: GameState, side: Side, personality: Personality): number {
  if (state.status === 'finished') {
    if (state.winner === 'draw') return 0;
    return state.winner === side ? MATE : -MATE;
  }
  let score = 0;
  for (const piece of state.pieces) score += (piece.side === side ? 1 : -1) * value(piece, personality);
  if (state.check) score += state.check === side ? -35 : 35;
  return score;
}

export function chooseMove(state: GameState, personality: Personality, budgetMs = 1000): Choice {
  if (!['cautious', 'balanced', 'aggressive'].includes(personality)) throw new Error('Invalid personality');
  if (state.status !== 'playing') return { move: null, depth: 0, nodes: 0, score: evaluate(state, state.turn, personality) };
  const legal = getLegalMoves(state);
  if (legal.length === 0) return { move: null, depth: 0, nodes: 0, score: -MATE };
  const deadline = Date.now() + Math.max(0, budgetMs);
  const side = state.turn;
  let nodes = 0;
  let best = ordered(state, legal)[0];
  let bestScore = evaluate(state, side, personality);
  let completedDepth = 0;
  const visit = () => { if ((++nodes & 15) === 0 && Date.now() >= deadline) throw TIMEOUT; };
  const terminal = (s: GameState, ply: number): number | null => {
    if (s.status !== 'finished') return null;
    if (s.winner === 'draw') return 0;
    const win = MATE - (s.reason === 'stalemate' ? 100 : 0) - ply;
    return s.winner === s.turn ? win : -win;
  };
  const quiescence = (s: GameState, alpha: number, beta: number, ply: number, remaining: number): number => {
    visit();
    const end = terminal(s, ply);
    if (end !== null) return end;
    const stand = evaluate(s, s.turn, personality);
    if (!s.check) {
      if (stand >= beta) return beta;
      if (stand > alpha) alpha = stand;
    }
    if (remaining <= 0) return stand;
    let moves = getLegalMoves(s);
    if (!s.check) moves = moves.filter(m => at(s, m.to.x, m.to.y));
    if (moves.length === 0) return alpha;
    for (const move of ordered(s, moves)) {
      const child = applyMove(s, move);
      const score = -quiescence(child, -beta, -alpha, ply + 1, remaining - 1);
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  };
  const search = (s: GameState, depth: number, alpha: number, beta: number, ply: number): number => {
    visit();
    const end = terminal(s, ply);
    if (end !== null) return end;
    if (depth <= 0) return quiescence(s, alpha, beta, ply, 4);
    const moves = ordered(s, getLegalMoves(s));
    if (moves.length === 0) return -MATE + ply;
    for (const move of moves) {
      const child = applyMove(s, move);
      const score = -search(child, depth - 1, -beta, -alpha, ply + 1);
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  };
  for (let depth = 1; depth <= 8; depth++) {
    if (Date.now() >= deadline) break;
    try {
      let iterationBest = best;
      let iterationScore = -Infinity;
      let alpha = -MATE - 1;
      for (const move of ordered(state, legal, best)) {
        const child = applyMove(state, move);
        const score = -search(child, depth - 1, -MATE - 1, -alpha, 1);
        if (score > iterationScore) { iterationScore = score; iterationBest = move; }
        if (score > alpha) alpha = score;
      }
      best = iterationBest; bestScore = iterationScore; completedDepth = depth;
      if (Math.abs(bestScore) >= MATE - 10) break;
    } catch (error) {
      if (error !== TIMEOUT) throw error;
      break;
    }
  }
  return { move: best, depth: completedDepth, nodes, score: bestScore };
}
