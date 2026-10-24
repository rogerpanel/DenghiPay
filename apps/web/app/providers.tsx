'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Locale, Translator, detectLocale, isLocale, translatorFor } from '@/lib/i18n';
import { api, clearSession, restoreSession } from '@/lib/api';

interface Account {
  id: string;
  email: string;
  status: string;
  kycTier: number;
  locale: Locale;
  emailVerified: boolean;
  /** Where this sender lives; decides which corridors they are offered. */
  residencyCountry: string;
  capabilities: { canQuote: boolean; canTransfer: boolean; nextKycTier: number | null };
}

interface AppContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translator;
  account: Account | null;
  loading: boolean;
  refreshAccount: () => Promise<void>;
  signOut: () => void;
  online: boolean;
}

const AppContext = createContext<AppContextValue | null>(null);

const LOCALE_KEY = 'morapay.locale';

export function Providers({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('ru');
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(true);

  const refreshAccount = useCallback(async () => {
    try {
      const me = await api<Account>('/auth/me');
      setAccount(me);
    } catch {
      setAccount(null);
    }
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem(LOCALE_KEY);
    setLocaleState(isLocale(stored) ? stored : detectLocale());

    void (async () => {
      await restoreSession();
      await refreshAccount();
      setLoading(false);
    })();

    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    // BUILD_PLAN 10.7 — installable, with a service worker that keeps the shell
    // usable when the connection drops.
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [refreshAccount]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    window.localStorage.setItem(LOCALE_KEY, next);
  }, []);

  const signOut = useCallback(() => {
    clearSession();
    setAccount(null);
    window.location.href = '/login';
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      locale,
      setLocale,
      t: translatorFor(locale),
      account,
      loading,
      refreshAccount,
      signOut,
      online,
    }),
    [locale, setLocale, account, loading, refreshAccount, signOut, online],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (context === null) throw new Error('useApp must be used inside Providers');
  return context;
}
