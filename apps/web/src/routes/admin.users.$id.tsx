import { createFileRoute } from '@tanstack/react-router';
import { UserDetail } from '../components/admin/UserDetail';
import { canManageUsers } from '../lib/api/queries/admin';
import { useMe } from '../lib/api/queries/session';

// /admin/users/$id : fiche d'une personne ; actions réservées à `users.manage`.
export const Route = createFileRoute('/admin/users/$id')({
  component: AdminUserPage,
});

function AdminUserPage() {
  const { id } = Route.useParams();
  const me = useMe();
  return <UserDetail id={id} canManage={canManageUsers(me.data)} />;
}
