import type { GameState, Move, RuleConfig, Side } from './types';
export interface RoomPlayer { id: string; name: string; seat: Side | null; ready: boolean }
export interface RoomSnapshot {
  code: string;
  members: RoomPlayer[];
  seats: Record<Side, RoomPlayer | null>;
  game: GameState | null;
  rules: RuleConfig;
  revision: number;
  drawOffer: Side | null;
}
export type ClientMessage =
  | { type: 'create'; name: string; rules?: RuleConfig }
  | { type: 'join'; code: string; name: string }
  | { type: 'sit'; side: Side }
  | { type: 'stand' }
  | { type: 'ready'; ready: boolean }
  | { type: 'move'; move: Move }
  | { type: 'resign' }
  | { type: 'drawOffer' }
  | { type: 'drawRespond'; accept: boolean }
  | { type: 'leave' }
  | { type: 'ping' };
export type ServerMessage =
  | { type: 'welcome'; playerId: string }
  | { type: 'room'; room: RoomSnapshot }
  | { type: 'error'; message: string }
  | { type: 'left' }
  | { type: 'pong' };
