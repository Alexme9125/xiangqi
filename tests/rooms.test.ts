import assert from 'node:assert/strict';
import { test } from 'node:test';
import WebSocket from 'ws';
import { createAppServer } from '../server/index';
import type { RoomSnapshot, ServerMessage } from '../shared/protocol';
import type { RuleConfig } from '../shared/types';

interface TestClient {
  socket: WebSocket;
  next(predicate?: (message: ServerMessage) => boolean): Promise<ServerMessage>;
  send(message: unknown): void;
  close(): Promise<void>;
}

async function client(port: number): Promise<TestClient> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const messages: ServerMessage[] = [];
  const waiters: Array<{ predicate: (message: ServerMessage) => boolean; resolve: (message: ServerMessage) => void }> = [];
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString()) as ServerMessage;
    const index = waiters.findIndex((waiter) => waiter.predicate(message));
    if (index >= 0) waiters.splice(index, 1)[0].resolve(message);
    else messages.push(message);
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return {
    socket,
    next(predicate = () => true) {
      const index = messages.findIndex(predicate);
      if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
      return new Promise<ServerMessage>((resolve, reject) => {
        const waiter = { predicate, resolve: (message: ServerMessage) => { clearTimeout(timer); resolve(message); } };
        const timer = setTimeout(() => {
          const pending = waiters.indexOf(waiter);
          if (pending >= 0) waiters.splice(pending, 1);
          reject(new Error('Timed out waiting for WebSocket message'));
        }, 2_000);
        waiters.push(waiter);
      });
    },
    send(message) { socket.send(JSON.stringify(message)); },
    close() {
      if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
      return new Promise<void>((resolve) => {
        socket.once('close', () => resolve());
        socket.close();
      });
    },
  };
}

function room(message: ServerMessage): RoomSnapshot {
  if (message.type !== 'room') throw new Error(`Expected room, received ${message.type}`);
  return message.room;
}

function expectRules(snapshot: RoomSnapshot, expected: RuleConfig): void {
  assert.deepEqual(snapshot.rules, expected);
  if (snapshot.game) assert.deepEqual(snapshot.game.rules, expected);
}

test('three clients create, play, observe, disconnect, replace and rematch', async () => {
  const server = createAppServer({ heartbeatMs: 100 });
  const port = await server.listen(0, '127.0.0.1');
  const red = await client(port);
  const black = await client(port);
  const spectator = await client(port);
  try {
    const welcome = await Promise.all([red.next(), black.next(), spectator.next()]);
    assert.ok(welcome.every((message) => message.type === 'welcome'));
    const [redId, blackId, spectatorId] = welcome.map((message) =>
      message.type === 'welcome' ? message.playerId : '');

    red.send({ type: 'create', name: 'Red', rules: { repetition: 'friendly', noCaptureLimit: 0 } });
    const created = room(await red.next((message) => message.type === 'room'));
    assert.equal(created.seats.red?.id, redId);
    assert.equal(created.rules.noCaptureLimit, 0);
    const code = created.code;

    black.send({ type: 'join', code, name: 'Black' });
    assert.equal(room(await black.next((message) => message.type === 'room')).seats.black?.id, blackId);
    spectator.send({ type: 'join', code, name: 'Watcher' });
    const joined = room(await spectator.next((message) => message.type === 'room'));
    assert.equal(joined.members.length, 3);
    assert.equal(joined.members.find((member) => member.id === spectatorId)?.seat, null);

    spectator.send({ type: 'ready', ready: true });
    assert.equal((await spectator.next((message) => message.type === 'error')).type, 'error');
    spectator.send({ type: 'move', move: { from: { x: 0, y: 6 }, to: { x: 0, y: 5 } } });
    assert.equal((await spectator.next((message) => message.type === 'error')).type, 'error');
    red.socket.send('{broken');
    assert.equal((await red.next((message) => message.type === 'error')).type, 'error');
    red.send({ type: 'sit', side: 'black', id: blackId });
    assert.equal((await red.next((message) => message.type === 'error')).type, 'error');

    red.send({ type: 'ready', ready: true });
    await red.next((message) => message.type === 'room' && message.room.seats.red?.ready === true);
    black.send({ type: 'ready', ready: true });
    const started = room(await black.next((message) => message.type === 'room' && message.room.game?.status === 'playing'));
    assert.equal(started.game?.turn, 'red');
    assert.equal(started.game?.pieces.length, 32);
    assert.equal(room(await spectator.next((message) => message.type === 'room' && message.room.game?.status === 'playing')).game?.pieces.length, 32);

    black.send({ type: 'move', move: { from: { x: 0, y: 3 }, to: { x: 0, y: 4 } } });
    assert.equal((await black.next((message) => message.type === 'error')).type, 'error');
    red.send({ type: 'move', move: { from: { x: 0, y: 3 }, to: { x: 0, y: 4 } } });
    assert.equal((await red.next((message) => message.type === 'error')).type, 'error');
    red.send({ type: 'move', move: { from: { x: 0, y: 6 }, to: { x: 0, y: 5 } } });
    const moved = room(await black.next((message) => message.type === 'room' && message.room.game?.history.length === 1));
    assert.equal(moved.game?.turn, 'black');
    assert.equal(room(await spectator.next((message) => message.type === 'room' && message.room.game?.history.length === 1)).game?.history.length, 1);

    red.send({ type: 'drawOffer' });
    await black.next((message) => message.type === 'room' && message.room.drawOffer === 'red');
    black.send({ type: 'drawRespond', accept: false });
    await black.next((message) => message.type === 'room' && message.room.drawOffer === null && message.room.game?.history.length === 1);

    await black.close();
    const ended = room(await red.next((message) => message.type === 'room' && message.room.game?.status === 'finished'));
    assert.equal(ended.game?.winner, 'red');
    assert.equal(ended.seats.black, null);
    assert.equal(room(await spectator.next((message) => message.type === 'room' && message.room.game?.status === 'finished')).game?.winner, 'red');

    spectator.send({ type: 'sit', side: 'black' });
    assert.equal(room(await spectator.next((message) => message.type === 'room' && message.room.seats.black?.id === spectatorId)).seats.black?.id, spectatorId);
    spectator.send({ type: 'ready', ready: true });
    await spectator.next((message) => message.type === 'room' && message.room.seats.black?.ready === true);
    red.send({ type: 'ready', ready: true });
    const rematch = room(await red.next((message) => message.type === 'room' && message.room.game?.status === 'playing' && message.room.revision > ended.revision));
    assert.equal(rematch.game?.history.length, 0);
    red.send({ type: 'stand' });
    assert.equal((await red.next((message) => message.type === 'error')).type, 'error');
    red.send({ type: 'leave' });
    assert.equal((await red.next((message) => message.type === 'left')).type, 'left');
    assert.equal(room(await spectator.next((message) => message.type === 'room' && message.room.game?.status === 'finished' && message.room.game.winner === 'black')).game?.winner, 'black');
    spectator.send({ type: 'leave' });
    assert.equal((await spectator.next((message) => message.type === 'left')).type, 'left');
    assert.equal(server.rooms.roomCount, 0);
  } finally {
    await Promise.all([red.close(), spectator.close()]);
    await server.close();
  }
});

for (const scenario of [
  { name: 'default competition rules', rules: undefined, expected: { repetition: 'wxf', noCaptureLimit: 100 } as RuleConfig },
  { name: 'explicit simplified practice rules', rules: { repetition: 'check-loss', noCaptureLimit: 100 } as RuleConfig,
    expected: { repetition: 'check-loss', noCaptureLimit: 100 } as RuleConfig },
]) {
  test(`${scenario.name} remain fixed through join, spectators and rematch`, async () => {
    const server = createAppServer();
    const port = await server.listen(0, '127.0.0.1');
    const red = await client(port);
    const black = await client(port);
    const spectator = await client(port);
    try {
      await Promise.all([red.next(), black.next(), spectator.next()]);
      red.send({ type: 'create', name: '红方', rules: { repetition: 'unknown', noCaptureLimit: 100 } });
      assert.equal((await red.next((message) => message.type === 'error')).type, 'error');
      red.send({ type: 'create', name: '红方', rules: { repetition: 'wxf', noCaptureLimit: -1 } });
      assert.equal((await red.next((message) => message.type === 'error')).type, 'error');
      assert.equal(server.rooms.roomCount, 0);

      red.send({ type: 'create', name: '红方', ...(scenario.rules ? { rules: scenario.rules } : {}) });
      const created = room(await red.next((message) => message.type === 'room'));
      expectRules(created, scenario.expected);
      const code = created.code;
      black.send({ type: 'join', code, name: '黑方' });
      expectRules(room(await black.next((message) => message.type === 'room')), scenario.expected);
      spectator.send({ type: 'join', code, name: '观战' });
      const watching = room(await spectator.next((message) => message.type === 'room'));
      assert.equal(watching.members.find((member) => member.name === '观战')?.seat, null);
      expectRules(watching, scenario.expected);

      const otherRules: RuleConfig = scenario.expected.repetition === 'wxf'
        ? { repetition: 'check-loss', noCaptureLimit: 50 }
        : { repetition: 'wxf', noCaptureLimit: 50 };
      black.send({ type: 'create', name: '黑方', rules: otherRules });
      assert.equal((await black.next((message) => message.type === 'error')).type, 'error');
      black.send({ type: 'create', name: '黑方', rules: otherRules, code });
      assert.equal((await black.next((message) => message.type === 'error')).type, 'error');
      black.send({ type: 'join', code, name: '黑方', rules: otherRules });
      assert.equal((await black.next((message) => message.type === 'error')).type, 'error');
      assert.equal(server.rooms.roomCount, 1);

      red.send({ type: 'ready', ready: true });
      expectRules(room(await spectator.next((message) => message.type === 'room' && message.room.seats.red?.ready === true)), scenario.expected);
      black.send({ type: 'ready', ready: true });
      const started = room(await black.next((message) => message.type === 'room' && message.room.game?.status === 'playing'));
      expectRules(started, scenario.expected);
      expectRules(room(await spectator.next((message) => message.type === 'room' && message.room.game?.status === 'playing')), scenario.expected);

      red.send({ type: 'resign' });
      const finished = room(await black.next((message) => message.type === 'room' && message.room.game?.status === 'finished'));
      expectRules(finished, scenario.expected);
      expectRules(room(await spectator.next((message) => message.type === 'room' && message.room.game?.status === 'finished')), scenario.expected);
      black.send({ type: 'ready', ready: true });
      red.send({ type: 'ready', ready: true });
      const rematch = room(await red.next((message) => message.type === 'room' &&
        message.room.game?.status === 'playing' && message.room.revision > finished.revision));
      assert.equal(rematch.game?.history.length, 0);
      expectRules(rematch, scenario.expected);
      expectRules(room(await spectator.next((message) => message.type === 'room' &&
        message.room.game?.status === 'playing' && message.room.revision > finished.revision)), scenario.expected);

      spectator.send({ type: 'leave' });
      await spectator.next((message) => message.type === 'left');
      const afterSpectatorLeaves = room(await black.next((message) => message.type === 'room' &&
        message.room.members.length === 2 && message.room.revision > rematch.revision));
      assert.equal(afterSpectatorLeaves.game?.status, 'playing');
      expectRules(afterSpectatorLeaves, scenario.expected);
      red.send({ type: 'leave' });
      await red.next((message) => message.type === 'left');
      black.send({ type: 'leave' });
      await black.next((message) => message.type === 'left');
      assert.equal(server.rooms.roomCount, 0);
    } finally {
      await Promise.all([red.close(), black.close(), spectator.close()]);
      await server.close();
    }
  });
}

test('spectator exit preserves active match and validates room inputs', async () => {
  const server = createAppServer();
  const port = await server.listen(0, '127.0.0.1');
  const red = await client(port);
  const black = await client(port);
  const watcher = await client(port);
  try {
    await Promise.all([red.next(), black.next(), watcher.next()]);
    red.send({ type: 'create', name: '   ' });
    assert.equal((await red.next((message) => message.type === 'error')).type, 'error');
    red.send({ type: 'create', name: 'R', rules: { repetition: 'friendly', noCaptureLimit: -1 } });
    assert.equal((await red.next((message) => message.type === 'error')).type, 'error');
    red.send({ type: 'create', name: 'R' });
    const code = room(await red.next((message) => message.type === 'room')).code;
    black.send({ type: 'join', code: code.toLowerCase(), name: 'B' });
    await black.next((message) => message.type === 'room');
    watcher.send({ type: 'join', code, name: 'W' });
    await watcher.next((message) => message.type === 'room');
    red.send({ type: 'ready', ready: true });
    black.send({ type: 'ready', ready: true });
    await red.next((message) => message.type === 'room' && message.room.game?.status === 'playing');
    watcher.send({ type: 'leave' });
    await watcher.next((message) => message.type === 'left');
    const current = room(await red.next((message) => message.type === 'room' &&
      message.room.members.length === 2 && message.room.game?.status === 'playing'));
    assert.equal(current.game?.status, 'playing');
    assert.equal(server.rooms.roomCount, 1);
    red.send({ type: 'leave' });
    await red.next((message) => message.type === 'left');
    black.send({ type: 'leave' });
    await black.next((message) => message.type === 'left');
    assert.equal(server.rooms.roomCount, 0);
  } finally {
    await Promise.all([red.close(), black.close(), watcher.close()]);
    await server.close();
  }
});
