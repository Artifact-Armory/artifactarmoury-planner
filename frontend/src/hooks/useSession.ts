import { useEffect, useState } from 'react';
import apiClient from '../api/client';
import { ensureSessionId, SESSION_HEADER, storeSessionId } from '../utils/session';

function subscribeToStorage(callback: (value: string | null) => void) {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handler = (event: StorageEvent) => {
    if (event.key === 'terrain_builder_session') {
      callback(event.newValue);
    }
  };

  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

export function useSession(): { sessionId: string | null; refreshSession: () => string | null } {
  const [sessionId, setSessionId] = useState<string | null>(() => ensureSessionId());

  useEffect(() => {
    if (sessionId) {
      apiClient.defaults.headers.common[SESSION_HEADER] = sessionId;
    }
  }, [sessionId]);

  useEffect(() => {
    return subscribeToStorage((value) => {
      if (value && value !== sessionId) {
        setSessionId(value);
        apiClient.defaults.headers.common[SESSION_HEADER] = value;
      }
    });
  }, [sessionId]);

  const refreshSession = () => {
    const id = ensureSessionId();
    if (id) {
      storeSessionId(id);
      setSessionId(id);
      apiClient.defaults.headers.common[SESSION_HEADER] = id;
    }
    return id;
  };

  return { sessionId, refreshSession };
}
