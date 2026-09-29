import { randomBytes, randomUUID } from 'node:crypto';
import type WebSocket from 'ws';
import { applyMove, createGame } from '../shared/engine';
import type { ClientMessage, RoomPlayer, RoomSnapshot, ServerMessage } from '../shared/protocol';
import { DEFAULT_RULES, type GameState, type Move, type RuleConfig, type Side } from '../shared/types';

const MAX_MEMBERS = 32;
const MAX_ROOMS = 1_000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
type Command = ClientMessage;

export interface Session {
  id: string;
  socket: WebSocket;
  roomCode: string | null;
}

interface Member {
  session: Session;
  name: string;
  seat: Side | null;
  ready: boolean;
}

interface Room {
  code: string;
  members: Map<string, Member>;
  game: GameState | null;
  rules: RuleConfig;
  revision: number;
  drawOffer: Side | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function keysOnly(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function validPoint(value: unknown): boolean {
  return isRecord(value) && keysOnly(value, ['x', 'y']) &&
    typeof value.x === 'number' && typeof value.y === 'number' &&
    Number.isInteger(value.x) && Number.isInteger(value.y) &&
    (value.x as number) >= 0 && (value.x as number) <= 8 &&
    (value.y as number) >= 0 && (value.y as number) <= 9;
}

function validMove(value: unknown): value is Move {
  return isRecord(value) && keysOnly(value, ['from', 'to']) &&
    validPoint(value.from) && validPoint(value.to);
}

function validRules(value: unknown): value is RuleConfig {
  return isRecord(value) && keysOnly(value, ['repetition', 'noCaptureLimit']) &&
    (value.repetition === 'wxf' || value.repetition === 'friendly' || value.repetition === 'check-loss') &&
    typeof value.noCaptureLimit === 'number' &&
    Number.isInteger(value.noCaptureLimit) &&
    (value.noCaptureLimit as number) >= 0 && (value.noCaptureLimit as number) <= 500;
}

function validName(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value &&
    Array.from(value).length >= 1 && Array.from(value).length <= 24 &&
    !/[\x00-\x1f\x7f]/.test(value);
}

export function parseCommand(raw: unknown): Command | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') return null;
  switch (raw.type) {
    case 'create':
      return keysOnly(raw, ['type', 'name', 'rules']) && validName(raw.name) &&
        (raw.rules === undefined || validRules(raw.rules)) ? raw as unknown as Command : null;
    case 'join':
      return keysOnly(raw, ['type', 'code', 'name']) && validName(raw.name) &&
        typeof raw.code === 'string' && /^[A-HJ-NP-Z2-9]{6}$/i.test(raw.code)
        ? raw as unknown as Command : null;
    case 'sit':
      return keysOnly(raw, ['type', 'side']) && (raw.side === 'red' || raw.side === 'black')
        ? raw as unknown as Command : null;
    case 'ready':
      return keysOnly(raw, ['type', 'ready']) && typeof raw.ready === 'boolean'
        ? raw as unknown as Command : null;
    case 'move':
      return keysOnly(raw, ['type', 'move']) && validMove(raw.move)
        ? raw as unknown as Command : null;
    case 'drawRespond':
      return keysOnly(raw, ['type', 'accept']) && typeof raw.accept === 'boolean'
        ? raw as unknown as Command : null;
    case 'stand':
    case 'resign':
    case 'drawOffer':
    case 'leave':
    case 'ping':
      return keysOnly(raw, ['type']) ? raw as unknown as Command : null;
    default:
      return null;
  }
}

function player(member: Member): RoomPlayer {
  return { id: member.session.id, name: member.name, seat: member.seat, ready: member.ready };
}

function snapshot(room: Room): RoomSnapshot {
  const members = [...room.members.values()].map(player);
  return {
    code: room.code,
    members,
    seats: {
      red: members.find((member) => member.seat === 'red') ?? null,
      black: members.find((member) => member.seat === 'black') ?? null,
    },
    game: room.game,
    rules: room.rules,
    revision: room.revision,
    drawOffer: room.drawOffer,
  };
}

function send(session: Session, message: ServerMessage): void {
  if (session.socket.readyState === 1) session.socket.send(JSON.stringify(message));
}

export class RoomService {
  private readonly rooms = new Map<string, Room>();

  get roomCount(): number { return this.rooms.size; }

  newSession(socket: WebSocket): Session {
    const session: Session = { id: randomUUID(), socket, roomCode: null };
    send(session, { type: 'welcome', playerId: session.id });
    return session;
  }

  private error(session: Session, message: string): void {
    send(session, { type: 'error', message });
  }

  private roomFor(session: Session): { room: Room; member: Member } | null {
    const room = session.roomCode ? this.rooms.get(session.roomCode) : undefined;
    const member = room?.members.get(session.id);
    if (!room || !member) {
      this.error(session, '请先加入房间。');
      return null;
    }
    return { room, member };
  }

  private broadcast(room: Room): void {
    room.revision++;
    const message: ServerMessage = { type: 'room', room: snapshot(room) };
    for (const member of room.members.values()) send(member.session, message);
  }

  private nextCode(): string {
    for (let attempt = 0; attempt < 100; attempt++) {
      const bytes = randomBytes(6);
      const code = [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('无法生成房间号。');
  }

  private finish(room: Room, winner: Side | 'draw', reason: string): void {
    if (!room.game || room.game.status !== 'playing') return;
    room.game = { ...room.game, status: 'finished', winner, reason };
    room.drawOffer = null;
    for (const member of room.members.values()) member.ready = false;
  }

  private leave(session: Session, acknowledge: boolean): void {
    const code = session.roomCode;
    const room = code ? this.rooms.get(code) : undefined;
    const member = room?.members.get(session.id);
    session.roomCode = null;
    if (room && member) {
      if (member.seat && room.game?.status === 'playing') {
        this.finish(room, member.seat === 'red' ? 'black' : 'red', '对手离开');
      }
      room.members.delete(session.id);
      if (room.members.size === 0) this.rooms.delete(room.code);
      else this.broadcast(room);
    }
    if (acknowledge) send(session, { type: 'left' });
  }

  disconnect(session: Session): void {
    this.leave(session, false);
  }

  handle(session: Session, command: Command): void {
    if (command.type === 'ping') { send(session, { type: 'pong' }); return; }
    if (command.type === 'leave') {
      if (!session.roomCode) { this.error(session, '请先加入房间。'); return; }
      this.leave(session, true);
      return;
    }
    if (command.type === 'create') {
      if (session.roomCode) { this.error(session, '请先离开当前房间。'); return; }
      if (this.rooms.size >= MAX_ROOMS) { this.error(session, '房间数量已达上限。'); return; }
      const code = this.nextCode();
      const rules = { ...DEFAULT_RULES, ...command.rules };
      const room: Room = { code, members: new Map(), game: null, rules, revision: 0, drawOffer: null };
      room.members.set(session.id, { session, name: command.name, seat: 'red', ready: false });
      this.rooms.set(code, room);
      session.roomCode = code;
      this.broadcast(room);
      return;
    }
    if (command.type === 'join') {
      if (session.roomCode) { this.error(session, '请先离开当前房间。'); return; }
      const room = this.rooms.get(command.code.toUpperCase());
      if (!room) { this.error(session, '房间不存在。'); return; }
      if (room.members.size >= MAX_MEMBERS) { this.error(session, '房间人数已满。'); return; }
      const taken = new Set([...room.members.values()].map((member) => member.seat));
      const seat: Side | null = room.game?.status === 'playing' ? null
        : !taken.has('red') ? 'red' : !taken.has('black') ? 'black' : null;
      room.members.set(session.id, { session, name: command.name, seat, ready: false });
      session.roomCode = room.code;
      this.broadcast(room);
      return;
    }
    const located = this.roomFor(session);
    if (!located) return;
    const { room, member } = located;
    switch (command.type) {
      case 'sit': {
        if (room.game?.status === 'playing') { this.error(session, '对局进行中不能换座。'); return; }
        if (member.seat) { this.error(session, '请先离座，再选择其他座位。'); return; }
        if ([...room.members.values()].some((other) => other.seat === command.side)) {
          this.error(session, '该座位已有人。'); return;
        }
        member.seat = command.side;
        member.ready = false;
        this.broadcast(room);
        return;
      }
      case 'stand':
        if (room.game?.status === 'playing') { this.error(session, '对局进行中不能换座。'); return; }
        if (!member.seat) { this.error(session, '你已经在观战。'); return; }
        member.seat = null;
        member.ready = false;
        this.broadcast(room);
        return;
      case 'ready': {
        if (room.game?.status === 'playing') { this.error(session, '对局已经开始。'); return; }
        if (!member.seat) { this.error(session, '只有入座玩家可以准备。'); return; }
        member.ready = command.ready;
        const seats = [...room.members.values()].filter((other) => other.seat);
        if (seats.length === 2 && seats.every((other) => other.ready)) {
          room.game = createGame(room.rules);
          room.drawOffer = null;
          for (const other of seats) other.ready = false;
        }
        this.broadcast(room);
        return;
      }
      case 'move':
        if (!member.seat || !room.game || room.game.status !== 'playing') {
          this.error(session, '只有正在对局的入座玩家可以走棋。'); return;
        }
        if (room.game.turn !== member.seat) { this.error(session, '还没轮到你走棋。'); return; }
        try { room.game = applyMove(room.game, command.move); }
        catch { this.error(session, '此棋步不合法。'); return; }
        room.drawOffer = null;
        if (room.game.status === 'finished') {
          for (const other of room.members.values()) other.ready = false;
        }
        this.broadcast(room);
        return;
      case 'resign':
        if (!member.seat || room.game?.status !== 'playing') {
          this.error(session, '只有正在对局的入座玩家可以认输。'); return;
        }
        this.finish(room, member.seat === 'red' ? 'black' : 'red', '认输');
        this.broadcast(room);
        return;
      case 'drawOffer':
        if (!member.seat || room.game?.status !== 'playing') {
          this.error(session, '只有正在对局的入座玩家可以提和。'); return;
        }
        if (room.drawOffer) { this.error(session, '已有待回应的提和。'); return; }
        room.drawOffer = member.seat;
        this.broadcast(room);
        return;
      case 'drawRespond':
        if (!member.seat || room.game?.status !== 'playing' || !room.drawOffer || room.drawOffer === member.seat) {
          this.error(session, '当前没有需要你回应的提和。'); return;
        }
        if (command.accept) this.finish(room, 'draw', '双方同意和棋');
        else room.drawOffer = null;
        this.broadcast(room);
        return;
    }
  }
}
