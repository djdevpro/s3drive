import {
  APP_LIST_DEFAULT_LIMIT,
  APP_LIST_MAX_LIMIT,
  type AdminPermission,
  type AdminUser,
  HOME_SPACE,
  SUPER_ADMIN_ROLE,
  adminUserListQuerySchema,
  adminUserPatchSchema,
  paginationQuerySchema,
} from '@ud/contracts';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import { apiError } from '../../errors.js';
import { clientIp } from '../../request.js';
import { requireUser } from '../auth.js';
import { computeGrants, hasAdmin } from '../grants.js';
import { recountHome } from '../maintenance.js';
import { type InstanceEnv, type InstanceRuntime, actorOf } from '../runtime.js';
import { type UserRow, userRoles } from '../users.js';
import { parseJson, parseQuery } from './util.js';

// Administration des personnes.

function requireAdmin(permission: AdminPermission): MiddlewareHandler<InstanceEnv> {
  return async (c, next) => {
    if (!hasAdmin(c.var.principal.grants, permission)) throw apiError('forbidden', 'Administration permission required', { reason: 'admin_permission', permission });
    await next();
  };
}

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

export function adminUserView(rt: InstanceRuntime, row: UserRow): AdminUser {
  const roles = userRoles(row);
  const usage = rt.usage.get(HOME_SPACE, row.id);
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    roles,
    status: row.status,
    quota: { limit: computeGrants(rt.config, roles, row.quota_override).quota, used: usage.bytes, reserved: usage.reserved, objects: usage.objects },
    quotaOverride: row.quota_override,
    termsVersion: row.terms_version,
    createdAt: new Date(row.created_at).toISOString(),
    lastLoginAt: iso(row.last_login_at),
  };
}

const SORT_SQL: Record<string, string> = {
  name: "COALESCE(u.name, u.email, '') COLLATE NOCASE",
  email: "COALESCE(u.email, '') COLLATE NOCASE",
  lastLogin: 'COALESCE(u.last_login_at, 0)',
  usage: 'COALESCE(s.bytes, 0)',
  created: 'u.created_at',
};

function adminAudit(c: Context<InstanceEnv>, rt: InstanceRuntime, action: string, userId: string, details?: Record<string, unknown>): void {
  rt.audit.write({
    connectionId: rt.config.connection,
    source: 'web',
    actor: actorOf(c.var.principal.userId),
    action,
    details: { userId, ...details },
    ip: clientIp(c, rt.requestEnv),
  });
}

function target(rt: InstanceRuntime, c: Context<InstanceEnv>): UserRow {
  const row = rt.users.get(c.req.param('id') ?? '');
  if (!row) throw apiError('not_found', 'User not found');
  return row;
}

export function registerAdminRoutes(app: Hono<InstanceEnv>, rt: InstanceRuntime): void {
  const auth = requireUser(rt);
  const pagination = paginationQuerySchema({ defaultLimit: APP_LIST_DEFAULT_LIMIT, maxLimit: APP_LIST_MAX_LIMIT });

  app.get('/api/v1/admin/users', auth, requireAdmin('users.read'), (c) => {
    const q = parseQuery(c, adminUserListQuerySchema);
    const page = parseQuery(c, pagination);
    let offset = 0;
    if (page.cursor) {
      offset = Number.parseInt(Buffer.from(page.cursor, 'base64url').toString('utf8'), 10);
      if (!Number.isSafeInteger(offset) || offset < 0) throw apiError('validation', 'Invalid cursor', { reason: 'invalid_cursor' });
    }
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (q.q) {
      const like = `%${q.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      where.push("(u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')");
      params.push(like, like);
    }
    const sql = `SELECT u.* FROM user u LEFT JOIN space_usage s ON s.space_id = '${HOME_SPACE}' AND s.owner_id = u.id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${SORT_SQL[q.sort]} ${q.dir === 'desc' ? 'DESC' : 'ASC'}, u.id ASC LIMIT ? OFFSET ?`;
    const rows = rt.db.prepare(sql).all(...params, page.limit + 1, offset) as unknown as UserRow[];
    const more = rows.length > page.limit;
    const items = rows.slice(0, page.limit).map((row) => adminUserView(rt, row));
    const nextCursor = more ? Buffer.from(String(offset + page.limit)).toString('base64url') : null;
    return c.json({ items, nextCursor });
  });

  app.get('/api/v1/admin/users/:id', auth, requireAdmin('users.read'), (c) => c.json(adminUserView(rt, target(rt, c))));

  app.patch('/api/v1/admin/users/:id', auth, requireAdmin('users.manage'), async (c) => {
    const row = target(rt, c);
    const patch = await parseJson(c, adminUserPatchSchema);
    const principal = c.var.principal;
    if (patch.status !== undefined && patch.status !== row.status) {
      if (row.id === principal.userId) throw apiError('validation', 'You cannot change your own status', { reason: 'self' });
      if (userRoles(row).includes(SUPER_ADMIN_ROLE) && !principal.grants.superAdmin) {
        throw apiError('forbidden', 'Only a super admin can change a super admin', { reason: 'super_admin' });
      }
      rt.users.setStatus(row.id, patch.status);
      if (patch.status === 'suspended') {
        // sessions supprimées sur-le-champ (jetons et liens : avec leurs lots).
        const sessions = rt.sessions.deleteForUser(row.id);
        adminAudit(c, rt, 'admin.suspend_user', row.id, { sessions });
      } else {
        adminAudit(c, rt, 'admin.reactivate_user', row.id);
      }
    }
    if (patch.quotaOverride !== undefined && patch.quotaOverride !== row.quota_override) {
      rt.users.setQuotaOverride(row.id, patch.quotaOverride);
      adminAudit(c, rt, 'admin.set_quota', row.id, { quotaOverride: patch.quotaOverride });
    }
    return c.json(adminUserView(rt, rt.users.get(row.id)!));
  });

  app.post('/api/v1/admin/users/:id/recount', auth, requireAdmin('users.manage'), async (c) => {
    const row = target(rt, c);
    const sum = await recountHome(rt, row.id);
    adminAudit(c, rt, 'admin.recount_usage', row.id, sum);
    return c.json(adminUserView(rt, rt.users.get(row.id)!));
  });
}
