'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, clearStaffSession, restoreStaffSession } from '@/lib/api';

export interface Staff {
  id: string;
  displayName: string;
  roles: string[];
}

interface AdminContextValue {
  staff: Staff | null;
  loading: boolean;
  refreshStaff: () => Promise<void>;
  signOut: () => void;
  can: (...roles: string[]) => boolean;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function AdminProviders({ children }: { children: React.ReactNode }) {
  const [staff, setStaff] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshStaff = useCallback(async () => {
    try {
      setStaff(await api<Staff>('/admin/auth/me'));
    } catch {
      setStaff(null);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await restoreStaffSession();
      await refreshStaff();
      setLoading(false);
    })();
  }, [refreshStaff]);

  const signOut = useCallback(() => {
    clearStaffSession();
    setStaff(null);
    window.location.href = '/login';
  }, []);

  /**
   * Role check for the interface only.
   *
   * The server enforces the same rules and does not trust this — hiding a
   * button is a courtesy, not a control.
   */
  const can = useCallback(
    (...roles: string[]) => roles.some((role) => staff?.roles.includes(role) === true),
    [staff],
  );

  const value = useMemo(
    () => ({ staff, loading, refreshStaff, signOut, can }),
    [staff, loading, refreshStaff, signOut, can],
  );

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdmin(): AdminContextValue {
  const context = useContext(AdminContext);
  if (context === null) throw new Error('useAdmin must be used inside AdminProviders');
  return context;
}
