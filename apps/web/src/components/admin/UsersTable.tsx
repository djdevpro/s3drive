import type { AdminUser } from '@ud/contracts';
import { Badge, Button, cn, EmptyState, Input, NavLink, QuotaMeter, Skeleton, formatDate } from '@ud/ui';
import { ArrowDown, ArrowUp, Search, Users } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdminUsers } from '../../lib/api/queries/admin';
import { roleLabel } from '../shell/helpers';
import { adminErrorKey } from './format';

// Liste des personnes : recherche, tri et chargement par curseur ; état dans l'URL.

export type UserSort = 'name' | 'email' | 'lastLogin' | 'usage' | 'created';

export interface UsersTableProps {
  q: string | undefined;
  sort: UserSort | undefined;
  dir: 'asc' | 'desc' | undefined;
  onSearchChange: (next: { q?: string | undefined; sort?: UserSort | undefined; dir?: 'asc' | 'desc' | undefined }) => void;
}

export function userHref(id: string): string {
  return `/admin/users/${encodeURIComponent(id)}`;
}

export function UsersTable({ q, sort, dir, onSearchChange }: UsersTableProps) {
  const { t, i18n } = useTranslation(['admin', 'instance', 'common']);
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const [text, setText] = useState(q ?? '');
  const searchId = useId();
  const users = useAdminUsers({ q, sort, dir });
  const activeSort = sort ?? 'name';
  const activeDir = dir ?? 'asc';

  // Recherche différée de 250 ms, écrite dans l'URL (replace).
  useEffect(() => {
    const value = text.trim();
    if (value === (q ?? '')) return;
    const timer = setTimeout(() => onSearchChange({ q: value || undefined, sort, dir }), 250);
    return () => clearTimeout(timer);
  }, [text, q, sort, dir, onSearchChange]);

  const toggleSort = (column: UserSort) => {
    const nextDir = activeSort === column ? (activeDir === 'asc' ? 'desc' : 'asc') : column === 'lastLogin' || column === 'usage' ? 'desc' : 'asc';
    onSearchChange({ q, sort: column === 'name' && nextDir === 'asc' ? undefined : column, dir: nextDir === 'asc' ? undefined : nextDir });
  };

  const rows = users.data?.pages.flatMap((page) => page.items) ?? [];

  const header = (column: UserSort | null, label: string, className?: string) => {
    if (!column) {
      return (
        <th scope="col" className={cn('px-3 py-2 text-start font-medium', className)}>
          {label}
        </th>
      );
    }
    const active = activeSort === column;
    const Arrow = activeDir === 'asc' ? ArrowUp : ArrowDown;
    return (
      <th scope="col" aria-sort={active ? (activeDir === 'asc' ? 'ascending' : 'descending') : 'none'} className={cn('px-1 py-1 text-start font-medium', className)}>
        <button
          type="button"
          onClick={() => toggleSort(column)}
          className="inline-flex h-8 items-center gap-1 rounded-md px-2 ud-transition hover:bg-menu-hover outline-none focus-visible:outline-2 focus-visible:outline-focus"
        >
          {label}
          {active && <Arrow aria-hidden className="size-3.5 text-text-2" />}
        </button>
      </th>
    );
  };

  return (
    <section className="flex flex-col gap-4 p-4 md:p-6" aria-labelledby="ud-admin-users">
      <header className="flex flex-col gap-1">
        <p className="text-2xs font-medium text-text-2">{t('admin:title')}</p>
        <h1 id="ud-admin-users" className="text-2xl text-text-1">
          {t('admin:users.title')}
        </h1>
      </header>
      <div className="relative max-w-md">
        <label htmlFor={searchId} className="sr-only">
          {t('admin:users.search')}
        </label>
        <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-3" />
        <Input id={searchId} type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('admin:users.search')} className="ps-9" />
      </div>

      {users.error ? (
        <div role="alert" className="text-row text-text-1">
          {t(`admin:${adminErrorKey(users.error)}`)}{' '}
          <Button variant="link" onClick={() => void users.refetch()}>
            {t('common:actions.retry')}
          </Button>
        </div>
      ) : users.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <span className="sr-only">{t('common:states.loading')}</span>
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          variant="inline"
          icon={<Users aria-hidden />}
          title={q ? t('admin:users.emptySearch') : t('admin:users.empty')}
          headingLevel={2}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[760px] border-collapse text-row">
              <caption className="sr-only">{t('admin:users.caption', { count: rows.length })}</caption>
              <thead className="border-b border-line bg-app text-text-2">
                <tr>
                  {header('name', t('admin:users.columns.name'))}
                  {header('email', t('admin:users.columns.email'))}
                  {header(null, t('admin:users.columns.roles'))}
                  {header('usage', t('admin:users.columns.usage'))}
                  {header('lastLogin', t('admin:users.columns.lastLogin'))}
                  {header(null, t('admin:users.columns.status'))}
                </tr>
              </thead>
              <tbody>
                {rows.map((user) => (
                  <UserRow key={user.id} user={user} locale={locale} />
                ))}
              </tbody>
            </table>
          </div>
          {users.hasNextPage && (
            <div className="flex justify-center">
              <Button variant="secondary" loading={users.isFetchingNextPage} onClick={() => void users.fetchNextPage()}>
                {t('common:actions.loadMore')}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function UserRow({ user, locale }: { user: AdminUser; locale: string }) {
  const { t } = useTranslation(['admin', 'instance']);
  const name = user.name || user.email || user.id;
  return (
    <tr className="border-b border-line last:border-b-0 hover:bg-row-hover">
      <td className="px-3 py-2">
        <NavLink href={userHref(user.id)} className="font-medium text-text-1 underline-offset-4 hover:underline outline-none focus-visible:outline-2 focus-visible:outline-focus rounded-xs">
          <bdi>{name}</bdi>
        </NavLink>
      </td>
      <td className="px-3 py-2 text-text-2">
        {user.email ? (
          <span dir="ltr" className="inline-block max-w-56 truncate align-bottom">
            {user.email}
          </span>
        ) : (
          '—'
        )}
      </td>
      <td className="px-3 py-2">
        <span className="flex flex-wrap gap-1">
          {user.roles.map((role) => (
            <Badge key={role} tone={role === 'super_admin' || role === 'admin' ? 'accent' : 'neutral'}>
              {roleLabel(t, role)}
            </Badge>
          ))}
        </span>
      </td>
      <td className="w-48 px-3 py-2">
        <QuotaMeter used={user.quota.used} limit={user.quota.limit} title={false} locale={locale} />
      </td>
      <td className="px-3 py-2 text-text-2 tabular">
        {user.lastLoginAt ? <time dateTime={user.lastLoginAt}>{formatDate(user.lastLoginAt, locale, { style: 'relative' })}</time> : t('admin:users.never')}
      </td>
      <td className="px-3 py-2">
        <Badge tone={user.status === 'active' ? 'success' : 'danger'}>{t(`admin:status.${user.status}`)}</Badge>
      </td>
    </tr>
  );
}
