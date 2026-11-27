import type { OrganizationStatus, OrganizationType, Permission } from '@athena/shared';

/** Who is calling, resolved from the session on every request. */
export interface AuthContext {
  sessionId: string;
  user: {
    id: string;
    email: string;
    name: string;
    isPlatformAdmin: boolean;
    mustChangePassword: boolean;
    preferences: Record<string, unknown>;
  };
  /** Active tenant for this session (null for platform admins and users without a membership). */
  organization: {
    id: string;
    name: string;
    slug: string;
    type: OrganizationType;
    status: OrganizationStatus;
    /** The tenant's brand accent (#RRGGBB), when one is set. */
    accentColor?: string | null;
  } | null;
  membership: { id: string; roleId: string; roleKey: string; roleName: string } | null;
  permissions: ReadonlySet<Permission>;
}

/** AuthContext guaranteed to have an active organization (after requireOrg / requirePermission). */
export type TenantAuthContext = AuthContext & {
  organization: NonNullable<AuthContext['organization']>;
  membership: NonNullable<AuthContext['membership']>;
};
