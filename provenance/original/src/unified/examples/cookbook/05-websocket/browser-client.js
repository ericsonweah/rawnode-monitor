'use strict';

// This file is intended for RawNode's browser asset pipeline/import map.
import { RawSocketClient } from '#ws';

const socket = new RawSocketClient('ws://127.0.0.1:3000/realtime', {
  autoConnect: false,
  namespace: '/chat',
  query: { token: 'dev-token', userId: 'browser-user-1' },
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 250,
  reconnectionDelayMax: 5_000,
  ackTimeout: 5_000,
  offlineQueue: true,
  maxQueueMessages: 1_000,
  maxQueueBytes: 1024 * 1024,
});

socket.on('connect', async () => {
  console.log('WebSocket connected');

  const joined = await socket.timeout(5_000).emitWithAck('room:join', 'general');
  console.log('joined:', joined);

  const reply = await socket.timeout(5_000).emitWithAck('chat:message', {
    room: 'general',
    text: 'Hello over RawNode WebSocket',
  });
  console.log('server acknowledgement:', reply);
});

socket.on('chat:ready', (payload) => console.log('ready:', payload));
socket.on('chat:message', (payload) => console.log('message:', payload));
socket.on('disconnect', (info) => console.log('disconnected:', info));
socket.on('error', (error) => console.error('WebSocket error:', error));

socket.connect();
window.rawnodeSocket = socket;
