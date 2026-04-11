'use client';
import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { BuildLog } from '../types';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:4000';

interface BuildSocketOptions {
  buildId: string;
  onLog?: (log: BuildLog) => void;
  onStatus?: (status: string) => void;
  onComplete?: (result: { status: string; apkUrl?: string; duration?: number; errorMessage?: string }) => void;
  onFix?: (fix: { attempt: number; description: string; filesModified: string[] }) => void;
}

export function useBuildSocket({
  buildId,
  onLog,
  onStatus,
  onComplete,
  onFix,
}: BuildSocketOptions) {
  const socketRef = useRef<Socket | null>(null);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!buildId) return;

    const token = typeof window !== 'undefined'
      ? localStorage.getItem('apk_factory_token')
      : null;

    if (!token) return;

    const socket = io(`${WS_URL}/builds`, {
      auth: { token },
      transports: ['websocket'],
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('subscribe:build', { buildId });
    });

    socket.on('build:log', (data: any) => {
      if (data.buildId === buildId) onLog?.(data);
    });

    socket.on('build:status', (data: any) => {
      if (data.buildId === buildId) onStatus?.(data.status);
    });

    socket.on('build:complete', (data: any) => {
      if (data.buildId === buildId) onComplete?.(data);
    });

    socket.on('build:fix', (data: any) => {
      if (data.buildId === buildId) onFix?.(data);
    });

    socket.on('disconnect', () => {
      console.log('Build socket disconnected');
    });

    return () => {
      socket.emit('unsubscribe:build', { buildId });
      socket.disconnect();
    };
  }, [buildId]);

  return { disconnect };
}
