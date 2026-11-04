import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AccountMenu, AuthCard, Button, DropdownMenuItem, FileIcon, QuotaMeter, quotaLevel, SpaceIcon, useSpaceLabel } from '../src';
import { renderUi } from './render';

const sp = (s: string | null | undefined) => (s ?? '').replace(/[  ]/g, ' ');
const GB = 1_000_000_000;

describe('QuotaMeter', () => {
  it('seuils : normal < 80 % ≤ warn < 95 % ≤ full', () => {
    expect(quotaLevel(0.79 * GB, GB)).toBe('normal');
    expect(quotaLevel(0.8 * GB, GB)).toBe('warn');
    expect(quotaLevel(0.949 * GB, GB)).toBe('warn');
    expect(quotaLevel(0.95 * GB, GB)).toBe('full');
    expect(quotaLevel(2 * GB, GB)).toBe('full');
    expect(quotaLevel(5 * GB, null)).toBe('normal');
    expect(quotaLevel(5 * GB, 0)).toBe('normal');
  });

  it('« 312 Mo sur 1 Go » : rôle meter, valeurs et texte accessibles', () => {
    renderUi(<QuotaMeter used={312_000_000} limit={GB} />, { lng: 'fr' });
    const bar = screen.getByRole('meter', { name: 'Stockage' });
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe(String(GB));
    expect(bar.getAttribute('aria-valuenow')).toBe('312000000');
    expect(sp(bar.getAttribute('aria-valuetext'))).toBe('312 Mo sur 1 Go');
    expect(sp(screen.getByText(/sur 1/).textContent)).toBe('312 Mo sur 1 Go');
    const root = bar.closest('[data-slot="quota-meter"]') as HTMLElement;
    expect(root.getAttribute('data-level')).toBe('normal');
    expect((root.querySelector('[data-slot="quota-meter-fill"]') as HTMLElement).className).toContain('bg-meter-fill');
  });

  it('80 % : orange + texte (la couleur n’est jamais seule)', () => {
    renderUi(<QuotaMeter used={0.85 * GB} limit={GB} />, { lng: 'fr' });
    const root = document.querySelector('[data-slot="quota-meter"]') as HTMLElement;
    expect(root.getAttribute('data-level')).toBe('warn');
    expect((root.querySelector('[data-slot="quota-meter-fill"]') as HTMLElement).className).toContain('bg-meter-warn');
    expect(screen.getByText('Stockage presque plein')).toBeTruthy();
  });

  it('95 % : rouge ; plafond atteint : « plein », valeur bornée', () => {
    const { unmount } = renderUi(<QuotaMeter used={0.96 * GB} limit={GB} />, { lng: 'fr' });
    let root = document.querySelector('[data-slot="quota-meter"]') as HTMLElement;
    expect(root.getAttribute('data-level')).toBe('full');
    expect((root.querySelector('[data-slot="quota-meter-fill"]') as HTMLElement).className).toContain('bg-meter-full');
    expect(screen.getByText('Stockage presque plein')).toBeTruthy();
    unmount();
    renderUi(<QuotaMeter used={1.2 * GB} limit={GB} />, { lng: 'fr' });
    root = document.querySelector('[data-slot="quota-meter"]') as HTMLElement;
    expect(screen.getByText('Stockage plein')).toBeTruthy();
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe(String(GB));
    expect((root.querySelector('[data-slot="quota-meter-fill"]') as HTMLElement).style.transform).toBe('scaleX(1)');
  });

  it('illimité : texte seul, sans barre', () => {
    renderUi(<QuotaMeter used={312_000_000} limit={null} />, { lng: 'fr' });
    expect(screen.queryByRole('meter')).toBeNull();
    expect(sp(screen.getByText(/utilisés/).textContent)).toBe('312 Mo utilisés');
  });

  it('anglais et arabe (chiffres latins)', () => {
    const { unmount } = renderUi(<QuotaMeter used={312_000_000} limit={GB} />, { lng: 'en' });
    expect(screen.getByRole('meter', { name: 'Storage' }).getAttribute('aria-valuetext')).toBe('312 MB of 1 GB');
    unmount();
    renderUi(<QuotaMeter used={312_000_000} limit={GB} />, { lng: 'ar' });
    const text = screen.getByRole('meter').getAttribute('aria-valuetext') ?? '';
    expect(text).toMatch(/^312 .* من 1 /);
    expect(text).not.toMatch(/[٠-٩]/);
  });

  it('chargement : squelette, aria-busy', () => {
    renderUi(<QuotaMeter used={0} limit={GB} loading />);
    expect(document.querySelector('[data-slot="quota-meter"]')?.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByRole('meter')).toBeNull();
  });
});

describe('FileIcon', () => {
  it('catégorie déduite du nom, couleur de catégorie, aria-hidden', () => {
    const { container } = renderUi(<FileIcon name="rapport.pdf" size={32} />);
    const icon = container.querySelector('[data-slot="file-icon"]') as HTMLElement;
    expect(icon.getAttribute('data-category')).toBe('pdf');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(icon.className).toContain('text-ft-pdf');
    expect(icon.querySelector('[data-slot="file-icon-badge"]')?.textContent).toBe('PDF');
  });

  it('pastille d’extension seulement dès 32 px et pour 4 caractères au plus', () => {
    const { container } = renderUi(
      <>
        <FileIcon name="a.pdf" size={24} />
        <FileIcon name="a.numbers" size={48} />
        <FileIcon name="a.docx" size={48} />
      </>,
    );
    const badges = [...container.querySelectorAll('[data-slot="file-icon-badge"]')].map((b) => b.textContent);
    expect(badges).toEqual(['DOCX']);
  });

  it('dossier coloré, partagé, ouvert ; type MIME en repli ; états', () => {
    const { container } = renderUi(
      <>
        <FileIcon name="Photos/" folderColor="red" shared />
        <FileIcon category="folder" folderColor="inconnue" open />
        <FileIcon name="photo" contentType="image/jpeg" state="cut" />
        <FileIcon name="x.bin" state="error" />
      </>,
    );
    const icons = [...container.querySelectorAll('[data-slot="file-icon"]')] as HTMLElement[];
    expect(icons[0]?.className).toContain('text-folder-red');
    expect(icons[0]?.querySelector('[data-slot="file-icon-shared"]')).not.toBeNull();
    expect(icons[1]?.className).toContain('text-folder-neutral');
    expect(icons[2]?.getAttribute('data-category')).toBe('image');
    expect(icons[2]?.className).toContain('opacity-(--ud-cut-opacity)');
    expect(icons[3]?.getAttribute('data-category')).toBe('exec');
    expect(icons[3]?.querySelector('[data-slot="file-icon-error"]')).not.toBeNull();
  });
});

describe('SpaceIcon', () => {
  function Label({ kind, name }: { kind: 'home' | 'shared'; name?: string }) {
    return <span>{useSpaceLabel(kind, name)}</span>;
  }

  it('icône décorative ou nommée, libellés traduits', () => {
    const { container } = renderUi(
      <>
        <SpaceIcon kind="home" />
        <SpaceIcon kind="shared" label="Commun" />
        <Label kind="home" />
        <Label kind="shared" />
        <Label kind="shared" name="Commun" />
      </>,
      { lng: 'fr' },
    );
    expect(container.querySelector('[data-kind="home"]')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('img', { name: 'Commun' })).toBeTruthy();
    expect(screen.getByText('Mon drive')).toBeTruthy();
    expect(screen.getByText('Espace partagé')).toBeTruthy();
    expect(screen.getByText('Commun')).toBeTruthy();
  });
});

describe('AccountMenu', () => {
  it('nom, e-mail, rôles, « Se déconnecter » par callback ; clavier et Échap', async () => {
    const onSignOut = vi.fn();
    const onSettings = vi.fn();
    renderUi(
      <AccountMenu name="Ada Lovelace" email="ada@example.org" roles={['Administrateur', 'Utilisateur']} onSignOut={onSignOut}>
        <DropdownMenuItem onSelect={onSettings}>Paramètres</DropdownMenuItem>
      </AccountMenu>,
      { lng: 'fr' },
    );
    const trigger = screen.getByRole('button', { name: 'Compte : Ada Lovelace' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('ada@example.org').getAttribute('dir')).toBe('ltr');
    expect(within(menu).getByText('Administrateur')).toBeTruthy();
    expect(within(menu).getByText('Utilisateur')).toBeTruthy();
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Paramètres', 'Se déconnecter']);
    fireEvent.keyDown(menu, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(onSignOut).not.toHaveBeenCalled();

    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Se déconnecter' }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it('arabe : libellés traduits et menu en RTL', async () => {
    renderUi(<AccountMenu name="سارة" onSignOut={() => {}} compact />, { lng: 'ar' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'الحساب: سارة' }), { key: 'Enter' });
    const menu = await screen.findByRole('menu');
    expect(menu.getAttribute('dir')).toBe('rtl');
    expect(within(menu).getByRole('menuitem', { name: 'تسجيل الخروج' })).toBeTruthy();
  });
});

describe('AuthCard', () => {
  it('page centrée : main, titre h1, texte, actions, pied', () => {
    renderUi(
      <AuthCard
        title="Universal Drive"
        description="Connectez-vous pour accéder à vos fichiers."
        actions={<Button variant="primary">Se connecter avec Keycloak</Button>}
        footer={<a href="/connect">Utiliser mes propres identifiants S3</a>}
      >
        <p>Session terminée.</p>
      </AuthCard>,
    );
    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { level: 1, name: 'Universal Drive' })).toBeTruthy();
    expect(within(main).getByText('Session terminée.')).toBeTruthy();
    expect(within(main).getByRole('button', { name: 'Se connecter avec Keycloak' })).toBeTruthy();
    expect(within(main).getByRole('link', { name: 'Utiliser mes propres identifiants S3' })).toBeTruthy();
    expect(main.querySelector('.ud-auth-card')).not.toBeNull();
  });
});
