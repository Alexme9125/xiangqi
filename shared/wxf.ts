import type { Move, MoveRecord, Piece, Side } from './types';

/**
 * WXF repetition adjudication. Independently implemented from the 2018 WXF
 * rules and the method described by Tan & Medina (2024), arXiv:2412.17334.
 * Analyze only actual repeated positions; do not charge the move generator
 * for a chase scan on every ordinary move or search node.
 */
interface Movement {
  pseudo: (pieces: Piece[], piece: Piece) => Move[];
  move: (pieces: Piece[], move: Move) => Piece[];
  checked: (pieces: Piece[], side: Side) => boolean;
}
interface Verdict {
  winner: Side | 'draw' | null;
  reason: 'perpetual-check' | 'perpetual-chase' | 'repetition' | null;
  warning: { side: Side; kind: 'check' | 'chase' } | null;
}
interface Threat { attacker: string; victim: string }
const other = (side: Side): Side => side === 'red' ? 'black' : 'red';
const targetMove = (from: Piece, to: Piece): Move => ({ from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y } });
const blank = (): Verdict => ({ winner: null, reason: null, warning: null });

function sameTarget(move: Move, target: Piece): boolean { return move.to.x === target.x && move.to.y === target.y; }
function crossed(piece: Piece): boolean { return piece.side === 'red' ? piece.y <= 4 : piece.y >= 5; }
function possibleCapture(board: Piece[], attacker: Piece, victim: Piece, rules: Movement): boolean {
  return attacker.side !== victim.side && rules.pseudo(board, attacker).some(move => sameTarget(move, victim)) &&
    !rules.checked(rules.move(board, targetMove(attacker, victim)), attacker.side);
}

function alignedDefender(board: Piece[], defender: Piece, square: Piece): boolean {
  if (defender.x !== square.x && defender.y !== square.y) return false;
  const count = board.filter(p => defender.x === square.x
    ? p.x === square.x && p.y > Math.min(defender.y, square.y) && p.y < Math.max(defender.y, square.y)
    : p.y === square.y && p.x > Math.min(defender.x, square.x) && p.x < Math.max(defender.x, square.x)).length;
  return count === (defender.kind === 'cannon' ? 1 : 0);
}

function protectedVictim(board: Piece[], attacker: Piece, victim: Piece, rules: Movement): boolean {
  // WXF protection tiers: exchanging a lower-value attacker for a higher-value
  // victim is still a chase, even when the victim has a legal recapture.
  const tier = { king: 0, advisor: 1, elephant: 1, pawn: 1, horse: 2, cannon: 2, rook: 3 };
  if (tier[victim.kind] > tier[attacker.kind]) return false;
  const captured = rules.move(board, targetMove(attacker, victim));
  const enemyAtTarget = captured.find(p => p.id === attacker.id)!;
  for (const defender of captured) {
    if (defender.side !== victim.side) continue;
    // This is WXF chase protection, not ordinary recapture move generation.
    // Classify rook/cannon rays using the ORIGINAL occupancy, including an
    // attacking piece that currently serves as a cannon screen. Then test the
    // defender's king safety on the hypothetical post-capture board below.
    // WXF diagrams 39–41 require this distinction; see section 4.2 / algorithms
    // 2–3 at https://arxiv.org/html/2412.17334v1#S4.SS2 and the fixture tests.
    const canDefend = defender.kind === 'rook' || defender.kind === 'cannon'
      ? alignedDefender(board, defender, victim)
      : rules.pseudo(captured, defender).some(move => sameTarget(move, enemyAtTarget));
    if (!canDefend) continue;
    if (!rules.checked(rules.move(captured, targetMove(defender, enemyAtTarget)), defender.side)) return true;
  }
  return false;
}

function isThreat(board: Piece[], attacker: Piece | undefined, victim: Piece | undefined, rules: Movement): boolean {
  if (!attacker || !victim || attacker.kind === 'king' || attacker.kind === 'pawn' || victim.kind === 'king') return false;
  if (victim.kind === 'pawn' && !crossed(victim)) return false;
  if (!possibleCapture(board, attacker, victim, rules)) return false;
  if (attacker.kind === victim.kind && possibleCapture(board, victim, attacker, rules)) return false;
  return !protectedVictim(board, attacker, victim, rules);
}

function threats(board: Piece[], side: Side, rules: Movement): Threat[] {
  const result: Threat[] = [];
  for (const attacker of board) {
    if (attacker.side !== side || attacker.kind === 'king' || attacker.kind === 'pawn') continue;
    for (const move of rules.pseudo(board, attacker)) {
      const victim = board.find(p => p.x === move.to.x && p.y === move.to.y);
      if (isThreat(board, attacker, victim, rules)) result.push({ attacker: attacker.id, victim: victim!.id });
    }
  }
  return result;
}

function rewind(board: Piece[], record: MoveRecord): Piece[] {
  const previous = board.filter(p => p.id !== record.piece.id).concat({ ...record.piece });
  if (record.captured) previous.push({ ...record.captured });
  return previous;
}

/** Stable IDs follow the same chased piece, even when it keeps changing square. */
function violationLevel(side: Side, boards: Piece[][], records: MoveRecord[], rules: Movement): 0 | 1 | 2 {
  const own = records.map((record, index) => ({ record, index })).filter(item => item.record.piece.side === side);
  if (!own.length) return 0;
  if (own.every(({ record }) => record.check)) return 2;
  // Alternating check/chase or check/idle is permitted under WXF.
  if (own.some(({ record }) => record.check)) return 0;
  let commonVictims: Set<string> | null = null;
  for (const { record, index } of own) {
    if (record.captured || (record.piece.kind === 'pawn' && record.from.y !== record.to.y)) return 0;
    const beforeReply = boards[index + 1];
    const response = records[(index + 1) % records.length];
    // Wrap the final response around the known cycle. Coordinates, rather than
    // an assumed actor ID, also work when two identical pieces exchanged places.
    const afterReply = index + 2 < boards.length ? boards[index + 2] : rules.move(beforeReply, response);
    const escaped = new Set<string>();
    for (const threat of threats(beforeReply, side, rules)) {
      const attacker = afterReply.find(p => p.id === threat.attacker);
      const victim = afterReply.find(p => p.id === threat.victim);
      // A freely offered piece that the reply leaves en prise is not a chase.
      if (!isThreat(afterReply, attacker, victim, rules)) escaped.add(threat.victim);
    }
    if (!escaped.size) return 0;
    if (commonVictims === null) commonVictims = escaped;
    else commonVictims = new Set<string>([...commonVictims].filter((id: string) => escaped.has(id)));
    if (!commonVictims.size) return 0;
  }
  return 1;
}

export function judgeWxfRepetition(pieces: Piece[], history: MoveRecord[], keys: string[], movement: Movement): Verdict {
  const last = keys.at(-1);
  const matches: number[] = [];
  keys.forEach((key, index) => { if (key === last) matches.push(index); });
  // The initial position is occurrence one. WXF asks for a change after
  // three complete cycles, then adjudicates continued repetition.
  if (matches.length < 4) return blank();
  const begin = matches.at(-4)!;
  const records = history.slice(begin);
  if (!records.length) return blank();
  const boards: Piece[][] = new Array(records.length + 1);
  boards[records.length] = pieces;
  for (let i = records.length - 1; i >= 0; i--) boards[i] = rewind(boards[i + 1], records[i]);
  const red = violationLevel('red', boards, records, movement);
  const black = violationLevel('black', boards, records, movement);
  if (red === black) return matches.length >= 5 ? { winner: 'draw', reason: 'repetition', warning: null } : blank();
  const guilty: Side = red > black ? 'red' : 'black';
  const kind = Math.max(red, black) === 2 ? 'check' : 'chase';
  if (matches.length < 5) return { winner: null, reason: null, warning: { side: guilty, kind } };
  return { winner: other(guilty), reason: kind === 'check' ? 'perpetual-check' : 'perpetual-chase', warning: null };
}
