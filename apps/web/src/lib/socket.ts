'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

/**
 * One Socket.IO connection per tab. Same origin in production (the gateway routes /socket.io to the API);
 * NEXT_PUBLIC_SOCKET_URL points at the API in development. Pushes are a speed-up only: every screen also
 * re-syncs over HTTP, so a blocked websocket never loses data.
 */
let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    const url = process.env.NEXT_PUBLIC_SOCKET_URL || undefined;
    socket = url
      ? io(url, { path: '/socket.io', withCredentials: true })
      : io({ path: '/socket.io', withCredentials: true });
  }
  return socket;
}

export type RoomJoin = { kind: 'exam-staff'; examId: string } | { kind: 'attempt'; attemptId: string };

/** Joins a room (re-joining after every reconnect) and subscribes to events while mounted. */
export function useSocketRoom(join: RoomJoin | null, handlers: Record<string, (payload: never) => void>) {
  const [connected, setConnected] = useState(false);
  const handlersRef = useRef(handlers);
  // Keep the latest handlers without re-subscribing; written after render, read only from socket events.
  useEffect(() => {
    handlersRef.current = handlers;
  });
  const key = join ? JSON.stringify(join) : null;
  const eventNames = Object.keys(handlers).sort().join('|');

  useEffect(() => {
    if (!key) return;
    const s = getSocket();
    const onConnect = () => {
      setConnected(true);
      s.emit('join', JSON.parse(key), () => {});
    };
    const onDisconnect = () => setConnected(false);
    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    if (s.connected) onConnect();
    const subs = eventNames
      .split('|')
      .filter(Boolean)
      .map((name) => {
        const fn = (payload: unknown) => handlersRef.current[name]?.(payload as never);
        s.on(name, fn);
        return [name, fn] as const;
      });
    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      subs.forEach(([name, fn]) => s.off(name, fn));
    };
  }, [key, eventNames]);

  return { connected };
}
