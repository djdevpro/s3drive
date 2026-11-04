import type { AdminUser } from '@ud/contracts';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  EmptyState,
  Input,
  Label,
  NavLink,
  QuotaMeter,
  Skeleton,
  formatBytes,
  formatDate,
  toast,
} from '@ud/ui';
import { ArrowLeft, Link2, RefreshCw, UserCheck, UserX, UserRoundX } from 'lucide-react';
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DriveApiError } from '../../lib/api/client';
import { useAdminUser, useRecountAdminUser, useUpdateAdminUser } from '../../lib/api/queries/admin';
import { roleLabel } from '../shell/helpers';
import { adminErrorKey, parseQuota, QUOTA_UNITS, splitQuota, type QuotaUnit } from './format';

// Fiche d'une personne : rôles en lecture seule, dérogation de quota,
// suspension ou réactivation confirmée, recalcul de l'usage ; actions masquées sans `users.manage`.

export function UserDetail({ id, canManage }: { id: string; canManage: boolean }) {
  const { t, i18n } = useTranslation(['admin', 'instance', 'common']);
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const user = useAdminUser(id);

  const back = (
    <NavLink href="/admin" className="inline-flex items-center gap-1.5 self-start rounded-md text-row text-text-2 ud-transition hover:text-text-1 outline-none focus-visible:outline-2 focus-visible:outline-focus">
      <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
      {t('admin:user.back')}
    </NavLink>
  );

  if (user.error) {
    const notFound = user.error instanceof DriveApiError && user.error.code === 'not_found';
    return (
      <div className="flex flex-col gap-4 p-4 md:p-6">
        {back}
        <EmptyState
          variant="page"
          icon={<UserRoundX aria-hidden />}
          title={notFound ? t('admin:user.notFound') : t(`admin:${adminErrorKey(user.error)}`)}
          actions={
            notFound ? undefined : (
              <Button variant="secondary" onClick={() => void user.refetch()}>
                {t('common:actions.retry')}
              </Button>
            )
          }
          headingLevel={2}
        />
      </div>
    );
  }
  if (!user.data) {
    return (
      <div className="flex flex-col gap-4 p-4 md:p-6" aria-busy="true">
        {back}
        <span className="sr-only">{t('common:states.loading')}</span>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-32 w-full max-w-2xl" />
      </div>
    );
  }

  const data = user.data;
  const name = data.name || data.email || data.id;
  return (
    <div className="flex max-w-3xl flex-col gap-6 p-4 md:p-6">
      {back}
      <header className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="text-2xl text-text-1">
            <bdi>{name}</bdi>
          </h1>
          {data.email && (
            <p dir="ltr" className="self-start truncate text-row text-text-2">
              {data.email}
            </p>
          )}
        </div>
        <Badge tone={data.status === 'active' ? 'success' : 'danger'}>{t(`admin:status.${data.status}`)}</Badge>
        <CopyLinkButton />
      </header>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-row sm:grid-cols-[max-content_1fr]">
        <dt className="text-text-2">{t('admin:user.created')}</dt>
        <dd>
          <time dateTime={data.createdAt}>{formatDate(data.createdAt, locale, { style: 'medium' })}</time>
        </dd>
        <dt className="text-text-2">{t('admin:user.lastLogin')}</dt>
        <dd>{data.lastLoginAt ? <time dateTime={data.lastLoginAt}>{formatDate(data.lastLoginAt, locale, { style: 'medium' })}</time> : t('admin:users.never')}</dd>
        <dt className="text-text-2">{t('admin:user.terms')}</dt>
        <dd>{data.termsVersion ? t('admin:user.termsAccepted', { version: data.termsVersion }) : t('admin:user.termsNone')}</dd>
      </dl>

      <Section title={t('admin:user.rolesTitle')} description={t('admin:user.rolesHint')}>
        <div className="flex flex-wrap gap-1.5">
          {data.roles.length > 0 ? data.roles.map((role) => <Badge key={role}>{roleLabel(t, role)}</Badge>) : <span className="text-text-2">—</span>}
        </div>
      </Section>

      <Section title={t('admin:user.usageTitle')}>
        <div className="flex max-w-sm flex-col gap-3">
          <QuotaMeter used={data.quota.used} limit={data.quota.limit} title={false} locale={locale} />
          <p className="text-2xs text-text-2">{t('admin:user.objects', { count: data.quota.objects })}</p>
          {canManage && <RecountButton id={data.id} />}
        </div>
      </Section>

      <Section title={t('admin:user.quotaTitle')} description={data.quotaOverride === null ? t('admin:user.quotaFromRoles') : t('admin:user.quotaCustom')}>
        {canManage ? (
          <QuotaForm user={data} locale={locale} />
        ) : (
          <p className="text-row">{data.quota.limit === null ? t('admin:user.unlimited') : formatBytes(data.quota.limit, locale)}</p>
        )}
      </Section>

      {canManage && (
        <Section title={t('admin:user.accessTitle')} description={data.status === 'active' ? t('admin:user.suspendHint') : t('admin:user.reactivateHint')}>
          <StatusButton user={data} />
        </Section>
      )}
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-xl border border-line p-4">
      <div className="flex flex-col gap-0.5">
        <h2 id={id} className="text-md font-medium text-text-1">
          {title}
        </h2>
        {description && <p className="text-row text-text-2">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function CopyLinkButton() {
  const { t } = useTranslation('common');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success(t('actions.linkCopied'));
    } catch {
      toast.error(t('errors.clipboard'));
    }
  };
  return (
    <Button variant="ghost" size="sm" icon={<Link2 aria-hidden />} onClick={() => void copy()}>
      {t('actions.copyLink')}
    </Button>
  );
}

function RecountButton({ id }: { id: string }) {
  const { t } = useTranslation('admin');
  const recount = useRecountAdminUser(id);
  return (
    <Button
      variant="secondary"
      className="self-start"
      icon={<RefreshCw aria-hidden />}
      loading={recount.isPending}
      onClick={() =>
        recount.mutate(undefined, {
          onSuccess: () => toast.success(t('user.recounted')),
          onError: (error) => toast.error(t(adminErrorKey(error))),
        })
      }
    >
      {t('user.recount')}
    </Button>
  );
}

function QuotaForm({ user, locale }: { user: AdminUser; locale: string }) {
  const { t } = useTranslation(['admin', 'common']);
  const update = useUpdateAdminUser(user.id);
  const initial = user.quotaOverride !== null ? splitQuota(user.quotaOverride) : { value: '', unit: 'GB' as QuotaUnit };
  const [value, setValue] = useState(initial.value);
  const [unit, setUnit] = useState<QuotaUnit>(initial.unit);
  const [invalid, setInvalid] = useState(false);
  const valueId = useId();
  const unitId = useId();
  const errorId = useId();

  useEffect(() => {
    const next = user.quotaOverride !== null ? splitQuota(user.quotaOverride) : { value: '', unit: 'GB' as QuotaUnit };
    setValue(next.value);
    setUnit(next.unit);
  }, [user.quotaOverride]);

  const save = (event: FormEvent) => {
    event.preventDefault();
    const bytes = parseQuota(value, unit);
    if (bytes === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    update.mutate(
      { quotaOverride: bytes },
      { onSuccess: () => toast.success(t('admin:user.quotaSaved')), onError: (error) => toast.error(t(`admin:${adminErrorKey(error)}`)) },
    );
  };
  const reset = () =>
    update.mutate(
      { quotaOverride: null },
      { onSuccess: () => toast.success(t('admin:user.quotaReset')), onError: (error) => toast.error(t(`admin:${adminErrorKey(error)}`)) },
    );

  return (
    <form onSubmit={save} className="flex flex-col gap-3" noValidate>
      <p className="text-row text-text-1">
        {t('admin:user.quotaEffective', { value: user.quota.limit === null ? t('admin:user.unlimited') : formatBytes(user.quota.limit, locale) })}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={valueId}>{t('admin:user.quotaValue')}</Label>
          <Input
            id={valueId}
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
            className="w-32 tabular"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={unitId}>{t('admin:user.quotaUnit')}</Label>
          <select
            id={unitId}
            value={unit}
            onChange={(e) => setUnit(e.target.value as QuotaUnit)}
            className="h-8 rounded-md border border-input-border bg-panel px-2 text-row text-text-1 outline-none focus-visible:outline-2 focus-visible:outline-focus"
          >
            {QUOTA_UNITS.map((u) => (
              <option key={u.id} value={u.id}>
                {t(`admin:units.${u.id}`)}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="primary" loading={update.isPending && update.variables?.quotaOverride !== null}>
          {t('admin:user.quotaSave')}
        </Button>
        {user.quotaOverride !== null && (
          <Button type="button" variant="ghost" loading={update.isPending && update.variables?.quotaOverride === null} onClick={reset}>
            {t('admin:user.quotaUseRoles')}
          </Button>
        )}
      </div>
      {invalid && (
        <p id={errorId} role="alert" className="text-row text-danger-text">
          {t('admin:user.quotaInvalid')}
        </p>
      )}
    </form>
  );
}

function StatusButton({ user }: { user: AdminUser }) {
  const { t } = useTranslation(['admin', 'common']);
  const update = useUpdateAdminUser(user.id);
  const [open, setOpen] = useState(false);
  const suspending = user.status === 'active';
  const name = user.name || user.email || user.id;

  const confirm = () =>
    update.mutate(
      { status: suspending ? 'suspended' : 'active' },
      {
        onSuccess: () => {
          setOpen(false);
          toast.success(suspending ? t('admin:user.suspended', { name }) : t('admin:user.reactivated', { name }));
        },
        onError: (error) => {
          setOpen(false);
          toast.error(t(`admin:${adminErrorKey(error)}`));
        },
      },
    );

  return (
    <>
      <Button
        variant={suspending ? 'danger' : 'secondary'}
        className="self-start"
        icon={suspending ? <UserX aria-hidden /> : <UserCheck aria-hidden />}
        onClick={() => setOpen(true)}
      >
        {suspending ? t('admin:user.suspend') : t('admin:user.reactivate')}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{suspending ? t('admin:user.suspendTitle', { name }) : t('admin:user.reactivateTitle', { name })}</AlertDialogTitle>
            <AlertDialogDescription>{suspending ? t('admin:user.suspendBody') : t('admin:user.reactivateBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant={suspending ? 'danger' : 'primary'}
              onClick={(event) => {
                event.preventDefault();
                confirm();
              }}
            >
              {suspending ? t('admin:user.suspendConfirm') : t('admin:user.reactivateConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
