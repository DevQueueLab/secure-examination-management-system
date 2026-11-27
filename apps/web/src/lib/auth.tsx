'use client';

import type { OrganizationStatus, OrganizationType, Permission, WorkspacePreferences } from '@athena/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { api, isApiError, onUnauthenticated } from './api';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  isPlatformAdmin: boolean;
  mustChangePassword: boolean;
  preferences: Partial<WorkspacePreferences> & Record<string, unknown>;
}

export interface SessionOrganization {
  id: string;
  name: string;
  slug: string;
  type: OrganizationType;
  status: OrganizationStatus;
  /** The tenant's brand accent (#RRGGBB), when one is set. */
  accentColor?: string | null;
}

export interface SessionRole {
  id: string;
  key: string;
  name: string;
}

export interface Membership {
  organizationId: string;
  organizationName: string;
  organizationType: OrganizationType;
  roleKey: string;
  roleName: string;
}

/** Shape returned by /auth/login, /auth/me and /auth/switch-organization. */
export interface Me {
  user: SessionUser;
  organization: SessionOrganization | null;
  role: SessionRole | null;
  permissions: Permission[];
  memberships: Membership[];
}

export const ME_QUERY_KEY = ['auth', 'me'] as const;

const CANDIDATE_PERMISSIONS: readonly Permission[] = ['exams.take', 'results.view_own', 'disputes.raise'];

/** Who the shell is built for. Staff wins when someone holds both kinds of permission. */
export type Audience = 'platform' | 'staff' | 'candidate' | 'none';

export function audienceOf(me: Me | null | undefined): Audience {
  if (!me) return 'none';
  const staff = me.permissions.some((p) => !CANDIDATE_PERMISSIONS.includes(p));
  if (staff) return 'staff';
  if (me.permissions.includes('exams.take')) return 'candidate';
  if (me.user.isPlatformAdmin) return 'platform';
  return 'none';
}

/** Where someone lands after signing in. */
export function homePathFor(me: Me | null | undefined): string {
  if (!me) return '/sign-in';
  if (me.user.isPlatformAdmin && !me.organization) return '/platform';
  return '/dashboard';
}

/** Accept only same-origin paths for ?next= (no protocol-relative or backslash tricks). */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  if (next.startsWith('/sign-in')) return null;
  return next;
}

interface AuthContextValue {
  me: Me | null;
  isLoading: boolean;
  /** True when /auth/me failed for a reason other than 401 (API unreachable). */
  isError: boolean;
  refetch: () => void;
  can: (permission: Permission) => boolean;
  canAny: (permissions: readonly Permission[]) => boolean;
  audience: Audience;
  signIn: (email: string, password: string) => Promise<Me>;
  signOut: () => Promise<void>;
  switchOrganization: (organizationId: string) => Promise<Me>;
  updatePreferences: (patch: Partial<WorkspacePreferences>) => Promise<Partial<WorkspacePreferences>>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchMe(): Promise<Me | null> {
  try {
    return await api.get<Me>('/auth/me');
  } catch (error) {
    if (isApiError(error) && error.status === 401) return null;
    throw error;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();

  const query = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: fetchMe,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });

  const me = query.data ?? null;

  // A session that expires mid-use sends the person back to sign in, then returns them here.
  // A full page load drops every cached query of the ended session, and the shell's own
  // signed-out redirect cannot overtake it and lose the "session ended" notice.
  useEffect(() => {
    onUnauthenticated(() => {
      const current = queryClient.getQueryData<Me | null>(ME_QUERY_KEY);
      if (!current) return;
      const here = window.location.pathname + window.location.search;
      window.location.replace(`/sign-in?next=${encodeURIComponent(here)}&reason=expired`);
    });
    return () => onUnauthenticated(null);
  }, [queryClient]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const next = await api.post<Me>('/auth/login', { email, password });
      queryClient.clear();
      queryClient.setQueryData(ME_QUERY_KEY, next);
      return next;
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* the cookie is cleared server side when reachable; leave either way */
    }
    queryClient.clear();
    queryClient.setQueryData(ME_QUERY_KEY, null);
    router.replace('/sign-in');
  }, [queryClient, router]);

  const switchOrganization = useCallback(
    async (organizationId: string) => {
      const next = await api.post<Me>('/auth/switch-organization', { organizationId });
      // Everything cached belonged to the previous tenant.
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_QUERY_KEY[0] });
      queryClient.setQueryData(ME_QUERY_KEY, next);
      if (pathname !== homePathFor(next)) router.push(homePathFor(next));
      router.refresh();
      return next;
    },
    [pathname, queryClient, router],
  );

  const updatePreferences = useCallback(
    async (patch: Partial<WorkspacePreferences>) => {
      const res = await api.patch<{ preferences: Partial<WorkspacePreferences> }>('/auth/me/preferences', patch);
      queryClient.setQueryData<Me | null>(ME_QUERY_KEY, (prev) =>
        prev ? { ...prev, user: { ...prev.user, preferences: { ...prev.user.preferences, ...res.preferences } } } : prev,
      );
      return res.preferences;
    },
    [queryClient],
  );

  const value = useMemo<AuthContextValue>(() => {
    const granted = new Set<string>(me?.permissions ?? []);
    return {
      me,
      isLoading: query.isPending,
      isError: query.isError,
      refetch: () => void query.refetch(),
      can: (permission) => granted.has(permission),
      canAny: (permissions) => permissions.some((p) => granted.has(p)),
      audience: audienceOf(me),
      signIn,
      signOut,
      switchOrganization,
      updatePreferences,
    };
  }, [me, query, signIn, signOut, switchOrganization, updatePreferences]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

type CanProps = {
  children: ReactNode;
  /** Rendered when the permission is missing. */
  fallback?: ReactNode;
} & ({ permission: Permission; anyOf?: never } | { anyOf: readonly Permission[]; permission?: never });

/**
 * Shows children only when the current user holds the permission (or any of `anyOf`).
 * The API is the gatekeeper; this only decides what to show.
 */
export function Can({ permission, anyOf, children, fallback = null }: CanProps) {
  const { can, canAny } = useAuth();
  const allowed = permission ? can(permission) : canAny(anyOf ?? []);
  return <>{allowed ? children : fallback}</>;
}
