'use client';

import type {
  MembershipStatus,
  OrganizationStatus,
  OrganizationType,
  Permission,
} from '@athena/shared';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ME_QUERY_KEY } from '@/lib/auth';
import type {
  AuditFilters,
  AuditPage,
  CreatePersonResult,
  ImportReport,
  OnboardInput,
  OnboardResult,
  OrgSettings,
  PeopleFilters,
  PeoplePage,
  Person,
  PlatformOverview,
  Role,
  SlugCheck,
  TenantDetail,
  TenantPage,
} from './types';

export const adminKeys = {
  people: ['org', 'people'] as const,
  peopleList: (f: PeopleFilters) => ['org', 'people', f] as const,
  roles: ['org', 'roles'] as const,
  audit: (f: AuditFilters) => ['org', 'audit', f] as const,
  settings: ['org', 'settings'] as const,
  dashboard: ['org', 'dashboard'] as const,
  platform: ['platform'] as const,
  overview: ['platform', 'overview'] as const,
  tenants: (f: { q?: string; type?: OrganizationType; status?: OrganizationStatus }) =>
    ['platform', 'organizations', f] as const,
  tenant: (id: string) => ['platform', 'organization', id] as const,
  platformAudit: (f: AuditFilters) => ['platform', 'audit', f] as const,
};

// ---------- people ----------

export function usePeople(filters: PeopleFilters) {
  return useQuery({
    queryKey: adminKeys.peopleList(filters),
    queryFn: () => api.get<PeoplePage>('/org/people', { query: { ...filters } }),
    placeholderData: keepPreviousData,
  });
}

export function useCreatePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string;
      email: string;
      roleId: string;
      externalId?: string | null;
      cohort?: string | null;
    }) => api.post<CreatePersonResult>('/org/people', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.people });
      void qc.invalidateQueries({ queryKey: adminKeys.roles });
    },
  });
}

export function useUpdatePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      membershipId,
      ...patch
    }: {
      membershipId: string;
      roleId?: string;
      externalId?: string | null;
      cohort?: string | null;
      status?: MembershipStatus;
    }) => api.patch<Person>(`/org/people/${membershipId}`, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.people });
      void qc.invalidateQueries({ queryKey: adminKeys.roles });
    },
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (membershipId: string) =>
      api.post<{ temporaryPassword: string }>(`/org/people/${membershipId}/reset-password`),
  });
}

export function useImportPeople() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      format: 'csv' | 'json';
      data: string;
      dryRun: boolean;
      skipInvalid?: boolean;
      filename?: string | null;
    }) => api.post<ImportReport>('/org/people/import', input, { timeoutMs: 120_000 }),
    onSuccess: (report) => {
      if (report.committed) {
        void qc.invalidateQueries({ queryKey: adminKeys.people });
        void qc.invalidateQueries({ queryKey: adminKeys.roles });
      }
    },
  });
}

// ---------- roles ----------

export function useRoles(enabled = true) {
  return useQuery({
    queryKey: adminKeys.roles,
    queryFn: async () => (await api.get<{ items: Role[] }>('/org/roles')).items,
    enabled,
  });
}

export function useCreateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; description?: string | null; permissions: Permission[] }) =>
      api.post<Role>('/org/roles', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminKeys.roles }),
  });
}

export function useUpdateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...patch
    }: {
      id: string;
      name?: string;
      description?: string | null;
      permissions?: Permission[];
    }) => api.patch<Role>(`/org/roles/${id}`, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.roles });
      void qc.invalidateQueries({ queryKey: adminKeys.people });
    },
  });
}

export function useDeleteRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/org/roles/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminKeys.roles }),
  });
}

// ---------- audit ----------

const AUDIT_PAGE = 50;

/** The org audit log, or the platform's own (platform admins). Only the chosen feed is fetched. */
export function useAuditFeed(scope: 'org' | 'platform', filters: AuditFilters) {
  return useInfiniteQuery({
    queryKey: scope === 'org' ? adminKeys.audit(filters) : adminKeys.platformAudit(filters),
    queryFn: ({ pageParam }) =>
      api.get<AuditPage>(scope === 'org' ? '/org/audit' : '/platform/audit', {
        query: { ...filters, page: pageParam, pageSize: AUDIT_PAGE },
      }),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
    placeholderData: keepPreviousData,
  });
}

// ---------- settings ----------

export function useOrgSettings() {
  return useQuery({
    queryKey: adminKeys.settings,
    queryFn: () => api.get<OrgSettings>('/org/settings'),
  });
}

export function useUpdateOrgSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: {
      name?: string;
      contactEmail?: string | null;
      branding?: { accentColor?: string | null; tagline?: string | null };
    }) => api.patch<OrgSettings>('/org/settings', patch),
    onSuccess: (next) => {
      qc.setQueryData(adminKeys.settings, next);
      void qc.invalidateQueries({ queryKey: adminKeys.dashboard });
      // The organization name shows in the shell's switcher.
      void qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });
}

// ---------- platform ----------

export function usePlatformOverview() {
  return useQuery({
    queryKey: adminKeys.overview,
    queryFn: () => api.get<PlatformOverview>('/platform/overview'),
    refetchInterval: 30_000,
  });
}

export function useTenants(filters: {
  q?: string;
  type?: OrganizationType;
  status?: OrganizationStatus;
}) {
  return useQuery({
    queryKey: adminKeys.tenants(filters),
    queryFn: () =>
      api.get<TenantPage>('/platform/organizations', { query: { ...filters, pageSize: 200 } }),
    placeholderData: keepPreviousData,
  });
}

export function useTenant(id: string) {
  return useQuery({
    queryKey: adminKeys.tenant(id),
    queryFn: () => api.get<TenantDetail>(`/platform/organizations/${id}`),
  });
}

export function checkSlug(slug: string, signal?: AbortSignal) {
  return api.get<SlugCheck>('/platform/organizations/slug-availability', {
    query: { slug },
    signal,
    retries: 0,
  });
}

export function useOnboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OnboardInput) => api.post<OnboardResult>('/platform/organizations', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminKeys.platform }),
  });
}

function useTenantMutation<T>(fn: (vars: T) => Promise<TenantDetail>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (detail) => {
      qc.setQueryData(adminKeys.tenant(detail.id), detail);
      void qc.invalidateQueries({ queryKey: adminKeys.platform });
    },
  });
}

export const useSuspendTenant = () =>
  useTenantMutation(({ id, reason }: { id: string; reason: string }) =>
    api.post<TenantDetail>(`/platform/organizations/${id}/suspend`, { reason }),
  );
export const useReactivateTenant = () =>
  useTenantMutation((id: string) =>
    api.post<TenantDetail>(`/platform/organizations/${id}/reactivate`),
  );
export const useUpdateTenant = () =>
  useTenantMutation(
    ({
      id,
      ...patch
    }: {
      id: string;
      name?: string;
      contactEmail?: string | null;
      branding?: { accentColor?: string | null; tagline?: string | null };
    }) => api.patch<TenantDetail>(`/platform/organizations/${id}`, patch),
  );
