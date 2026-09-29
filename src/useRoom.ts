import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMessage, RoomSnapshot, ServerMessage } from '../shared/protocol';

export function useRoom(onError: (message: string) => void) {
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [playerId, setPlayerId] = useState('');
  const [connection, setConnection] = useState<'offline' | 'connecting' | 'online'>('offline');
  const socket = useRef<WebSocket | null>(null);
  const queue = useRef<ClientMessage[]>([]);
  const errorHandler = useRef(onError);
  errorHandler.current = onError;

  const connect = useCallback(() => {
    if (socket.current && socket.current.readyState < 2) return;
    setConnection('connecting');
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
    socket.current = ws;
    ws.onopen = () => {
      setConnection('online');
      queue.current.splice(0).forEach(message => ws.send(JSON.stringify(message)));
    };
    ws.onmessage = event => {
      const message = JSON.parse(event.data) as ServerMessage;
      if (message.type === 'welcome') setPlayerId(message.playerId);
      if (message.type === 'room') setRoom(message.room);
      if (message.type === 'left') setRoom(null);
      if (message.type === 'error') errorHandler.current(message.message);
    };
    ws.onclose = () => {
      if (socket.current !== ws) return;
      socket.current = null;
      setConnection('offline');
      setRoom(current => {
        if (current) errorHandler.current('连接已断开，本局已结束。请重新加入房间。');
        return null;
      });
      queue.current = [];
    };
    ws.onerror = () => errorHandler.current('无法连接房间服务，请检查网络后重试。');
  }, []);

  const send = useCallback((message: ClientMessage) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(message));
    else if (message.type === 'create' || message.type === 'join') {
      queue.current = [message];
      connect();
    } else errorHandler.current('尚未连接房间，请重新加入。');
  }, [connect]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ type: 'ping' }));
    }, 20_000);
    return () => { clearInterval(timer); socket.current?.close(); socket.current = null; };
  }, []);
  return { room, playerId, connection, send };
}
