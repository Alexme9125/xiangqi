export type Side = 'red' | 'black';
export type PieceKind = 'king' | 'advisor' | 'elephant' | 'horse' | 'rook' | 'cannon' | 'pawn';
export type Personality = 'cautious' | 'balanced' | 'aggressive';
export interface Point { x: number; y: number }
export interface Piece extends Point { id: string; side: Side; kind: PieceKind }
export interface Move { from: Point; to: Point }
export interface MoveRecord extends Move { piece: Piece; captured?: Piece; notation: string; check: boolean; ply: number }
export interface RuleConfig { repetition: 'wxf' | 'friendly' | 'check-loss'; noCaptureLimit: number }
export interface GameState {
  pieces: Piece[];
  turn: Side;
  status: 'playing' | 'finished';
  winner: Side | 'draw' | null;
  reason: string | null;
  history: MoveRecord[];
  positionKeys: string[];
  halfmoveClock: number;
  rules: RuleConfig;
  check: Side | null;
  repetitionWarning?: { side: Side; kind: 'check' | 'chase' } | null;
}
export const DEFAULT_RULES: RuleConfig = { repetition: 'wxf', noCaptureLimit: 100 };
