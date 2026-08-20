import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';

let globalSocket = null;
const SOCKET_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? window.location.origin : 'http://localhost:3001');

function createSocket() {
  if (globalSocket) {
    globalSocket.removeAllListeners();
    globalSocket.disconnect();
  }
  const token = localStorage.getItem('atlas-token');
  globalSocket = io(SOCKET_URL, {
    auth: { token },
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: 5,
  });
  return globalSocket;
}

function destroySocket() {
  if (globalSocket) {
    globalSocket.removeAllListeners();
    globalSocket.disconnect();
    globalSocket = null;
  }
}

export function useSession(user) {
  const [sessionId, setSessionId] = useState(null);
  const [sessionName, setSessionName] = useState('');
  const [members, setMembers] = useState([]);
  const [isHost, setIsHost] = useState(false);
  const [hostName, setHostName] = useState('');
  const [hostSnapshot, setHostSnapshot] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [joinRequests, setJoinRequests] = useState([]);
  const [sessionEnded, setSessionEnded] = useState(false);
  const lastSnapshotRef = useRef('');
  const throttleRef = useRef(null);

  const addNotification = useCallback((text) => {
    const id = Date.now();
    setNotifications((prev) => [...prev.slice(-4), { id, text }]);
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, 4000);
  }, []);

  // Connect socket when session is active
  useEffect(() => {
    if (!sessionId || !user) return;

    const token = localStorage.getItem('atlas-token');
    console.log('[Session] Connecting for session:', sessionId, 'token:', token ? token.slice(0, 20) + '...' : 'MISSING');
    if (!token) {
      console.error('[Session] No auth token found!');
      addNotification('Session error: not authenticated');
      return;
    }
    const socket = createSocket();

    socket.on('connect', () => {
      console.log('[Session] Connected:', socket.id);
      socket.emit('join-session', sessionId);
    });

    socket.on('connect_error', (err) => {
      console.error('[Session] Connection error:', err.message);
      addNotification(`Connection error: ${err.message}`);
    });

    socket.on('presence', ({ members: m, hostUserId, hostName: hn }) => {
      console.log('[Session] Presence:', m.length, 'members, host:', hostUserId);
      setMembers(m);
      setIsHost(user.id === hostUserId);
      setHostName(hn || 'Host');
    });

    socket.on('user-joined', ({ name }) => {
      addNotification(`${name} joined the session`);
    });

    socket.on('user-left', ({ name }) => {
      addNotification(`${name} left the session`);
    });

    socket.on('join-request', ({ name, socketId: sid }) => {
      setJoinRequests((prev) => [...prev, { name, socketId: sid }]);
      addNotification(`${name} joined your session`);
    });

    // Members receive the host's state snapshot
    socket.on('state-snapshot', (data) => {
      setHostSnapshot(data);
    });

    // Chat
    socket.on('chat-history', (msgs) => {
      if (msgs?.length) setChatMessages(msgs);
    });

    socket.on('chat-message', (msg) => {
      setChatMessages((prev) => [...prev, msg]);
    });

    socket.on('session-ended', ({ hostName: hn }) => {
      addNotification(`${hn || 'Host'} ended the session`);
      setSessionEnded(true);
    });

    socket.on('error', (msg) => {
      addNotification(`Error: ${msg}`);
    });

    socket.connect();

    return () => {
      console.log('[Session] Cleanup');
      socket.emit('leave-session');
      destroySocket();
    };
  }, [sessionId, user, addNotification]);

  const joinRoom = useCallback((id, name) => {
    console.log('[Session] joinRoom:', id, name);
    setChatMessages([]);
    setHostSnapshot(null);
    setSessionId(id);
    setSessionName(name);
  }, []);

  const leaveRoom = useCallback(() => {
    destroySocket();
    setSessionId(null);
    setSessionName('');
    setMembers([]);
    setChatMessages([]);
    setHostSnapshot(null);
    setIsHost(false);
    setJoinRequests([]);
    setSessionEnded(false);
  }, []);

  const dismissSessionEnded = useCallback(() => {
    setSessionEnded(false);
    leaveRoom();
  }, [leaveRoom]);

  // Host emits state snapshot — throttled to avoid flooding
  const emitStateSnapshot = useCallback((snapshot) => {
    if (!globalSocket?.connected) return;

    // Throttle: max once per 300ms
    if (throttleRef.current) return;
    throttleRef.current = setTimeout(() => { throttleRef.current = null; }, 300);

    // Skip if nothing changed
    const json = JSON.stringify(snapshot);
    if (json === lastSnapshotRef.current) return;
    lastSnapshotRef.current = json;

    globalSocket.emit('state-snapshot', snapshot);
  }, []);

  const sendChatMessage = useCallback((text) => {
    if (!text.trim()) return;
    globalSocket?.emit('chat-message', { text });
  }, []);

  return {
    sessionId,
    sessionName,
    members,
    notifications,
    chatMessages,
    isHost,
    hostName,
    hostSnapshot,
    joinRequests,
    joinRoom,
    leaveRoom,
    emitStateSnapshot,
    sendChatMessage,
    isInSession: !!sessionId,
    sessionEnded,
    dismissSessionEnded,
  };
}
