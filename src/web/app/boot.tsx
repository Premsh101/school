import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AcademicSession, Bootstrap, Branch, Me, Section } from '../../shared/types';
import { api, setSignedOutHandler } from './api';
import { t } from './i18n';

interface Boot extends Bootstrap {
  user: Me;
  can: (permission: string) => boolean;
  /** The session chosen in the top bar (the current one unless changed). */
  session: AcademicSession | undefined;
  setSessionId: (id: number) => void;
  activeBranches: Branch[];
  /** Every school this person may switch to (for admin: all schools). */
  myBranches: Branch[];
  /** The school chosen at sign-in, or null for all schools. */
  currentBranch: Branch | null;
  branchName: (id: number) => string;
  className: (id: number) => string;
  sectionsOf: (branchId: number, classId: number) => Section[];
  refresh: () => Promise<unknown>;
}

/** The school's logo: the one uploaded in Settings, or the one that ships with the app. */
export const DEFAULT_LOGO = '/logo-256.webp';
export const schoolLogo = (uploaded: string | undefined) => uploaded || DEFAULT_LOGO;

const BootContext = createContext<Boot | null>(null);

export function useBoot(): Boot {
  const boot = useContext(BootContext);
  if (!boot) throw new Error('useBoot needs a signed-in user');
  return boot;
}

export function useBootstrap() {
  return useQuery({
    queryKey: ['bootstrap'],
    queryFn: () => api.get<Bootstrap>('/bootstrap'),
    staleTime: 60_000,
  });
}

export function BootProvider({ data, children }: { data: Bootstrap; children: ReactNode }) {
  const client = useQueryClient();
  const [sessionId, setSessionId] = useState<number | null>(null);

  useEffect(() => {
    setSignedOutHandler(() => void client.invalidateQueries({ queryKey: ['bootstrap'] }));
  }, [client]);

  const value = useMemo<Boot>(() => {
    const user = data.user!;
    const session =
      data.sessions.find((s) => s.id === sessionId) ??
      data.sessions.find((s) => s.is_current) ??
      data.sessions[0];
    return {
      ...data,
      user,
      can: (permission) => user.permissions.includes(permission),
      session,
      setSessionId,
      activeBranches: data.branches.filter((b) => b.active),
      myBranches: data.my_branches,
      currentBranch: data.branches.find((b) => b.id === user.branch_id) ?? null,
      branchName: (id) =>
        [...data.my_branches, ...data.branches].find((b) => b.id === id)?.name ?? t('Other school'),
      className: (id) => data.classes.find((c) => c.id === id)?.name ?? '',
      sectionsOf: (branchId, classId) =>
        data.sections.filter((s) => s.branch_id === branchId && s.class_id === classId && s.active),
      refresh: () => client.invalidateQueries({ queryKey: ['bootstrap'] }),
    };
  }, [data, sessionId, client]);

  return <BootContext.Provider value={value}>{children}</BootContext.Provider>;
}
