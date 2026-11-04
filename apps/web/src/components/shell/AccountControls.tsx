import type { MeResponse } from '@ud/contracts';
import { AccountMenu, DropdownMenuItem, toast } from '@ud/ui';
import { Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLogout } from '../../lib/api/queries/session';
import { useSettingsNav } from '../../lib/settings';
import { roleLabel } from './helpers';
import { useErrorMessage } from './PageStates';

/** Déconnexion avec message d'erreur en notification. */
export function useSignOut(): { signOut: () => void; pending: boolean } {
  const { t } = useTranslation('instance');
  const logout = useLogout();
  const errorMessage = useErrorMessage();
  const signOut = () => {
    logout.mutate(undefined, { onError: (error) => toast.error(t('account.signOutFailed'), { description: errorMessage(error) }) });
  };
  return { signOut, pending: logout.isPending };
}

/**
 * Compte en bas à gauche de la barre latérale (comme dans Universal Email) : avatar, nom, e-mail ;
 * le menu donne les rôles Drive traduits, Paramètres et « Se déconnecter ».
 */
export function AccountControls({ me }: { me: MeResponse }) {
  const { t } = useTranslation(['common', 'instance']);
  const { signOut } = useSignOut();
  const settings = useSettingsNav();
  const name = me.user.name || me.user.email || me.user.id;

  return (
    <AccountMenu
      variant="card"
      name={name}
      email={me.user.email}
      roles={me.user.roles.map((role) => roleLabel(t, role))}
      onSignOut={signOut}
      side="top"
      align="start"
    >
      <DropdownMenuItem onSelect={() => settings.open('account')}>
        <Settings2 aria-hidden />
        {t('instance:account.settings')}
      </DropdownMenuItem>
    </AccountMenu>
  );
}
