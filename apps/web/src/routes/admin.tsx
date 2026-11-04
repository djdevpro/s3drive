import { Outlet, createFileRoute } from '@tanstack/react-router';
import { EmptyState } from '@ud/ui';
import { ShieldOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { InstanceShell } from '../components/shell/InstanceShell';
import { canReadUsers } from '../lib/api/queries/admin';

// Console d'administration de l'instance dans la coquille ; droit `users.read`.
export const Route = createFileRoute('/admin')({
  component: AdminLayout,
});

function AdminLayout() {
  return <InstanceShell>{(me) => (canReadUsers(me) ? <Outlet /> : <Forbidden />)}</InstanceShell>;
}

function Forbidden() {
  const { t } = useTranslation('admin');
  return <EmptyState variant="page" icon={<ShieldOff aria-hidden />} title={t('forbidden.title')} description={t('forbidden.body')} headingLevel={2} />;
}
