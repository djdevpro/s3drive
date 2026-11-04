// Écrans du mode instance : redirections de `/`, /login et ses erreurs, /terms, renvois
// 401 et 403, barre latérale selon /me, menu du compte, administration selon les droits.
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { LOGIN_ERRORS } from '@ud/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { API, adminUserFixture, fakeServer, installDomStubs, instanceInfo, meFixture, mountApp, termsFixture } from './instance-helpers';

beforeEach(() => installDomStubs());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const unauthorized = (reason?: string) => ({
  status: 401,
  body: { error: 'unauthorized', message: 'Authentication required', ...(reason ? { details: { reason } } : {}) },
});

describe('/', () => {
  it('session ouverte : redirige vers Mon drive', async () => {
    const server = fakeServer({ 'GET /api/v1/instance': { status: 200, body: instanceInfo }, 'GET /api/v1/me': { status: 200, body: meFixture() } });
    const app = mountApp('/', server);
    await waitFor(() => expect(app.location()).toBe('/d/drive/b/home/'));
  });

  it('sans session : redirige vers /login', async () => {
    const server = fakeServer({ 'GET /api/v1/instance': { status: 200, body: instanceInfo }, 'GET /api/v1/me': unauthorized() });
    const app = mountApp('/', server);
    await waitFor(() => expect(app.location()).toBe('/login'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Drive de test' })).toBeTruthy();
  });

  it('conditions à accepter : redirige vers /terms avec retour à Mon drive', async () => {
    const me = meFixture({ terms: { required: true, version: 'v1', url: '/api/v1/me/terms' } });
    const server = fakeServer({
      'GET /api/v1/instance': { status: 200, body: instanceInfo },
      'GET /api/v1/me': { status: 200, body: me },
      'GET /api/v1/me/terms': { status: 200, body: termsFixture },
    });
    const app = mountApp('/', server);
    await waitFor(() => expect(app.location()).toBe('/terms?next=%2Fd%2Fdrive%2Fb%2Fhome%2F'));
  });

  it('mode personnel : accueil des stockages personnels', async () => {
    const server = fakeServer({ 'GET /api/v1/instance': { status: 200, body: { ...instanceInfo, mode: 'personal', connection: null, login: null } } });
    mountApp('/', server);
    expect(await screen.findByRole('heading', { level: 1, name: 'Universal Drive' })).toBeTruthy();
  });
});

describe('/login', () => {
  const routes = () => ({ 'GET /api/v1/instance': { status: 200, body: instanceInfo }, 'GET /api/v1/me': unauthorized() });

  it('nom de l’instance et bouton « Se connecter avec » en navigation réseau, next transmis', async () => {
    const server = fakeServer(routes());
    mountApp('/login?next=%2Fd%2Fdrive%2Fb%2Fhome%2FDocs%2F', server);
    expect(await screen.findByRole('heading', { level: 1, name: 'Drive de test' })).toBeTruthy();
    const button = await screen.findByRole('link', { name: 'Se connecter avec Keycloak (dev)' });
    expect(button.getAttribute('href')).toBe(`${API}/api/v1/auth/oidc/login?next=%2Fd%2Fdrive%2Fb%2Fhome%2FDocs%2F`);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('next hors de l’appli ignoré', async () => {
    mountApp('/login?next=%2F%2Fevil.test%2F', fakeServer(routes()));
    const button = await screen.findByRole('link', { name: /Se connecter avec/ });
    expect(button.getAttribute('href')).toBe(`${API}/api/v1/auth/oidc/login`);
  });

  it.each(LOGIN_ERRORS)('erreur %s : message traduit dans une alerte', async (error) => {
    const app = mountApp(`/login?error=${error}`, fakeServer(routes()));
    const alert = await screen.findByRole('alert');
    const title = app.i18n.t(`instance:login.errors.${error}.title`);
    expect(title).not.toContain('login.errors');
    expect(within(alert).getByText(title)).toBeTruthy();
  });

  it('mode both : lien vers /connect', async () => {
    const server = fakeServer({ ...routes(), 'GET /api/v1/instance': { status: 200, body: { ...instanceInfo, mode: 'both', personal: true } } });
    mountApp('/login', server);
    const link = await screen.findByRole('link', { name: 'Utiliser mes propres identifiants S3' });
    expect(link.getAttribute('href')).toBe('/connect');
  });

  it('session déjà ouverte : retour à next', async () => {
    const server = fakeServer({ 'GET /api/v1/instance': { status: 200, body: instanceInfo }, 'GET /api/v1/me': { status: 200, body: meFixture() } });
    const app = mountApp('/login?next=%2Fadmin', server);
    await waitFor(() => expect(app.location().startsWith('/admin')).toBe(true));
  });
});

describe('/terms', () => {
  it('texte Markdown sûr, case à cocher, acceptation puis retour à next', async () => {
    const server = fakeServer({
      'GET /api/v1/instance': { status: 200, body: instanceInfo },
      'GET /api/v1/me/terms': { status: 200, body: termsFixture },
      'POST /api/v1/me/terms': { status: 204 },
      'GET /api/v1/me': { status: 200, body: meFixture() },
    });
    const app = mountApp('/terms?next=%2Fadmin', server);
    expect(await screen.findByRole('heading', { level: 2, name: 'Conditions' })).toBeTruthy();
    const region = screen.getByRole('region', { name: 'Texte des conditions d’utilisation' });
    expect(within(region).getByText('acceptez').tagName).toBe('STRONG');
    expect(within(region).getAllByRole('listitem')).toHaveLength(2);
    // Aucun HTML brut : la balise reste du texte, le lien javascript: reste du texte.
    expect(region.querySelector('script')).toBeNull();
    expect(within(region).getByText('<script>alert(1)</script>')).toBeTruthy();
    expect(within(region).getByText(/lien/).closest('a')).toBeNull();
    expect(within(region).getByRole('link', { name: 'site' }).getAttribute('href')).toBe('https://example.test');

    const submit = screen.getByRole('button', { name: 'Continuer' });
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(submit);
    expect(server.calls.some((c) => c.method === 'POST')).toBe(false);

    fireEvent.click(screen.getByRole('checkbox', { name: 'J’ai lu et j’accepte les conditions d’utilisation' }));
    expect(submit.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(submit);
    await waitFor(() => expect(app.location().startsWith('/admin')).toBe(true));
    const post = server.calls.find((c) => c.method === 'POST' && c.path === '/api/v1/me/terms');
    expect(post?.body).toEqual({ version: 'v1' });
    expect(post?.headers['X-UD']).toBe('1');
  });

  it('conditions déjà acceptées : retour direct à next', async () => {
    const server = fakeServer({
      'GET /api/v1/instance': { status: 200, body: instanceInfo },
      'GET /api/v1/me/terms': { status: 200, body: { ...termsFixture, acceptedVersion: 'v1' } },
      'GET /api/v1/me': { status: 200, body: meFixture() },
    });
    const app = mountApp('/terms?next=%2Fd%2Fdrive%2Frecent', server);
    await waitFor(() => expect(app.location()).toBe('/d/drive/recent'));
  });
});

describe('renvois 401 et 403', () => {
  it('401 session_ended sur /me : /login?error=session_ended&next=<url>', async () => {
    const server = fakeServer({ 'GET /api/v1/instance': { status: 200, body: instanceInfo }, 'GET /api/v1/me': unauthorized('session_ended') });
    const app = mountApp('/d/drive/recent?view=grid', server);
    await waitFor(() => expect(app.location()).toBe('/login?error=session_ended&next=%2Fd%2Fdrive%2Frecent%3Fview%3Dgrid'));
    expect(await screen.findByText('Votre session a pris fin')).toBeTruthy();
  });

  it('401 idp_unreachable : motif conservé', async () => {
    const server = fakeServer({ 'GET /api/v1/instance': { status: 200, body: instanceInfo }, 'GET /api/v1/me': unauthorized('idp_unreachable') });
    const app = mountApp('/admin', server);
    await waitFor(() => expect(app.location()).toBe('/login?error=idp_unreachable&next=%2Fadmin'));
  });

  it('403 terms_required sur une autre route : /terms?next=<url>', async () => {
    const server = fakeServer({
      'GET /api/v1/instance': { status: 200, body: instanceInfo },
      'GET /api/v1/me': { status: 200, body: meFixture({ admin: ['users.read'] }) },
      'GET /api/v1/me/terms': { status: 200, body: termsFixture },
      'GET /api/v1/admin/users': { status: 403, body: { error: 'forbidden', message: 'Terms', details: { reason: 'terms_required' } } },
    });
    const app = mountApp('/admin?q=bru', server);
    await waitFor(() => expect(app.location()).toBe('/terms?next=%2Fadmin%3Fq%3Dbru'));
  });
});

describe('coquille selon /me', () => {
  const routes = (me = meFixture()) => ({ 'GET /api/v1/instance': { status: 200, body: instanceInfo }, 'GET /api/v1/me': { status: 200, body: me } });

  it('Mon drive, espaces partagés, jauge ; pas d’Administration sans droit', async () => {
    mountApp('/d/drive/recent', fakeServer(routes()));
    const nav = await screen.findByRole('navigation', { name: 'Navigation' });
    const home = within(nav).getByRole('link', { name: /Mon drive/ });
    expect(home.getAttribute('href')).toBe('/d/drive/b/home/');
    const commun = within(nav).getByRole('link', { name: /Commun/ });
    expect(commun.getAttribute('href')).toBe('/d/drive/b/commun/');
    expect(commun.textContent).toContain('lecture seule');
    expect(within(nav).queryByRole('link', { name: 'Administration' })).toBeNull();
    // Vues non servies par le serveur : absentes.
    expect(within(nav).queryByRole('link', { name: /Récents|Corbeille/ })).toBeNull();
    const meter = screen.getByRole('meter');
    expect(meter.getAttribute('aria-valuetext')).toMatch(/312\s?Mo sur 1\s?Go/);
    // Nom de l'instance en tête de la barre latérale ; rail des connexions avec la pastille de l'instance.
    expect(document.querySelector('[data-pane=sidebar]')?.textContent).toContain('Drive de test');
    const rail = screen.getByRole('navigation', { name: 'Stockages' });
    const pill = within(rail).getByRole('link', { name: 'Drive de test' });
    expect(pill.getAttribute('href')).toBe('/d/drive/b/home/');
    expect(pill.getAttribute('aria-current')).toBe('page');
    expect(pill.textContent).toBe('D');
    // Mode instance seul : pas de « + » vers /connect, pas de barre du haut sur grand écran.
    expect(within(rail).queryByRole('link', { name: 'Ajouter un stockage' })).toBeNull();
    expect(screen.queryByRole('banner')).toBeNull();
  });

  it('entrée active selon l’URL ; Administration pour users.read', async () => {
    mountApp('/d/drive/b/commun/', fakeServer({ ...routes(meFixture({ admin: ['users.read'] })), 'GET /api/v1/admin/users': { status: 200, body: { items: [], nextCursor: null } } }));
    const nav = await screen.findByRole('navigation', { name: 'Navigation' });
    expect(within(nav).getByRole('link', { name: /Commun/ }).getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: /Mon drive/ }).getAttribute('aria-current')).toBeNull();
    expect(within(nav).getByRole('link', { name: 'Administration' }).getAttribute('href')).toBe('/admin');
  });

  it('super admin : Administration visible ; libellés d’espace en anglais', async () => {
    mountApp('/d/drive/recent', fakeServer(routes(meFixture({ superAdmin: true, user: { id: 'u3', email: null, name: 'Chloé', roles: ['super_admin'] } }))), { lng: 'en' });
    const nav = await screen.findByRole('navigation', { name: 'Navigation' });
    expect(within(nav).getByRole('link', { name: 'Administration' })).toBeTruthy();
    expect(within(nav).getByRole('link', { name: /My Drive/ })).toBeTruthy();
    expect(within(nav).getByRole('link', { name: /Shared/ })).toBeTruthy();
  });

  it('barre latérale repliable (mémorisée) et tiroir à 375 px', async () => {
    const app = mountApp('/d/drive/recent', fakeServer(routes()));
    const collapse = await screen.findByRole('button', { name: 'Réduire la barre latérale' });
    fireEvent.click(collapse);
    expect(JSON.parse(localStorage.getItem('ud.layout.v1') ?? '{}')).toEqual({ sidebarCollapsed: true });
    // Repliée : la barre latérale disparaît, le rail reste et propose de la déplier.
    expect(document.getElementById('ud-sidebar')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Déplier la barre latérale' }));
    expect(document.getElementById('ud-sidebar')?.getAttribute('data-mode')).toBe('full');
    app.unmount();

    installDomStubs({ width: 375 });
    mountApp('/d/drive/recent', fakeServer(routes()));
    const open = await screen.findByRole('button', { name: 'Ouvrir le menu' });
    expect(document.getElementById('ud-sidebar')).toBeNull();
    fireEvent.click(open);
    const drawer = screen.getByRole('dialog', { name: 'Navigation' });
    expect(within(drawer).getByRole('link', { name: /Mon drive/ })).toBeTruthy();
    expect(within(drawer).getByRole('navigation', { name: 'Stockages' })).toBeTruthy();
    expect(document.getElementById('ud-main')?.hasAttribute('inert')).toBe(true);
    fireEvent.keyDown(drawer, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull();
  });

  it('menu du compte : nom, e-mail, rôles traduits ; déconnexion vers /login', async () => {
    const server = fakeServer({ ...routes(meFixture({ user: { id: 'u1', email: 'alice@ud.test', name: 'Alice Martin', roles: ['admin', 'user', 'auditeur'] } })), 'POST /api/v1/auth/logout': { status: 200, body: { endSessionUrl: null } } });
    const app = mountApp('/d/drive/recent', server);
    const trigger = await screen.findByRole('button', { name: /Alice Martin/ });
    // En bas de la barre latérale, comme dans Universal Email ; plus de bouton de compte en haut.
    expect(trigger.closest('[data-pane=sidebar]')).toBeTruthy();
    expect(trigger.textContent).toContain('alice@ud.test');
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('alice@ud.test')).toBeTruthy();
    expect(within(menu).getByText('Administrateur')).toBeTruthy();
    expect(within(menu).getByText('Utilisateur')).toBeTruthy();
    expect(within(menu).getByText('auditeur')).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: 'Paramètres' })).toBeTruthy();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Se déconnecter' }));
    await waitFor(() => expect(app.location()).toBe('/login'));
    const logout = server.calls.find((c) => c.path === '/api/v1/auth/logout');
    expect(logout?.method).toBe('POST');
    expect(logout?.headers['X-UD']).toBe('1');
  });
});

describe('administration', () => {
  const list = { items: [adminUserFixture(), adminUserFixture({ id: 'u4', name: 'Damien Roux', email: 'damien@ud.test', status: 'suspended', lastLoginAt: null })], nextCursor: 'MjU' };
  const routes = (me = meFixture({ admin: ['users.read'] })) => ({
    'GET /api/v1/instance': { status: 200, body: instanceInfo },
    'GET /api/v1/me': { status: 200, body: me },
  });

  it('sans users.read : accès restreint, aucune requête de liste', async () => {
    const server = fakeServer(routes(meFixture()));
    mountApp('/admin', server);
    expect(await screen.findByRole('heading', { name: 'Accès restreint' })).toBeTruthy();
    expect(server.calls.some((c) => c.path === '/api/v1/admin/users')).toBe(false);
  });

  it('liste : colonnes, état, recherche et tri dans l’URL, page suivante par curseur', async () => {
    const server = fakeServer({
      ...routes(),
      'GET /api/v1/admin/users': (call) => ({
        status: 200,
        body: call.url.searchParams.get('cursor') === 'MjU' ? { items: [adminUserFixture({ id: 'u9', name: 'Zoé Blanc', email: 'zoe@ud.test' })], nextCursor: null } : list,
      }),
    });
    const app = mountApp('/admin', server);
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('link', { name: 'Bruno Petit' }).getAttribute('href')).toBe('/admin/users/u2');
    expect(within(table).getByText('damien@ud.test')).toBeTruthy();
    expect(within(table).getByText('Suspendu')).toBeTruthy();
    expect(within(table).getByText('Jamais')).toBeTruthy();
    expect(within(table).getAllByText('Utilisateur').length).toBeGreaterThan(0);

    fireEvent.click(within(table).getByRole('button', { name: /Stockage utilisé/ }));
    await waitFor(() => expect(app.location()).toBe('/admin?sort=usage&dir=desc'));
    await waitFor(() => expect(server.calls.some((c) => c.url.searchParams.get('sort') === 'usage' && c.url.searchParams.get('dir') === 'desc')).toBe(true));

    fireEvent.change(screen.getByRole('searchbox', { name: 'Rechercher par nom ou e-mail' }), { target: { value: 'bru' } });
    await waitFor(() => expect(app.location()).toBe('/admin?q=bru&sort=usage&dir=desc'));
    await waitFor(() => expect(server.calls.some((c) => c.url.searchParams.get('q') === 'bru')).toBe(true));

    fireEvent.click(await screen.findByRole('button', { name: 'Afficher plus' }));
    expect(await screen.findByRole('link', { name: 'Zoé Blanc' })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Afficher plus' })).toBeNull());
  });

  it('fiche sans users.manage : rôles en lecture seule, aucune action', async () => {
    const server = fakeServer({ ...routes(), 'GET /api/v1/admin/users/u2': { status: 200, body: adminUserFixture({ quotaOverride: 2_500_000_000, quota: { limit: 2_500_000_000, used: 2_000_000, reserved: 0, objects: 4 } }) } });
    mountApp('/admin/users/u2', server);
    expect(await screen.findByRole('heading', { level: 1, name: 'Bruno Petit' })).toBeTruthy();
    expect(screen.getByText('Rôles Drive')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Suspendre' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Recalculer l’usage' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Enregistrer le quota' })).toBeNull();
    expect(screen.getAllByText(/2,5\s?Go/).length).toBeGreaterThan(0);
  });

  it('fiche avec users.manage : suspension confirmée, dérogation de quota en Go, recalcul', async () => {
    let user = adminUserFixture();
    const server = fakeServer({
      ...routes(meFixture({ admin: ['users.read', 'users.manage'] })),
      'GET /api/v1/admin/users/u2': () => ({ status: 200, body: user }),
      'PATCH /api/v1/admin/users/u2': (call) => {
        const patch = call.body as { status?: 'active' | 'suspended'; quotaOverride?: number | null };
        user = { ...user, ...(patch.status ? { status: patch.status } : {}), ...(patch.quotaOverride !== undefined ? { quotaOverride: patch.quotaOverride } : {}) };
        return { status: 200, body: user };
      },
      'POST /api/v1/admin/users/u2/recount': () => ({ status: 200, body: user }),
      'GET /api/v1/admin/users': { status: 200, body: list },
    });
    mountApp('/admin/users/u2', server);
    fireEvent.click(await screen.findByRole('button', { name: 'Suspendre' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Suspendre Bruno Petit ?')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Suspendre' }));
    await waitFor(() => expect(server.calls.some((c) => c.method === 'PATCH' && (c.body as { status?: string }).status === 'suspended')).toBe(true));
    expect(await screen.findByRole('button', { name: 'Réactiver' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Quota personnalisé'), { target: { value: '2,5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le quota' }));
    await waitFor(() => expect(server.calls.some((c) => c.method === 'PATCH' && (c.body as { quotaOverride?: number }).quotaOverride === 2_500_000_000)).toBe(true));

    fireEvent.change(screen.getByLabelText('Quota personnalisé'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le quota' }));
    expect(await screen.findByText('Saisissez un nombre supérieur à zéro.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Recalculer l’usage' }));
    await waitFor(() => expect(server.calls.some((c) => c.method === 'POST' && c.path === '/api/v1/admin/users/u2/recount')).toBe(true));
  });

  it('refus du serveur traduit (self)', async () => {
    const server = fakeServer({
      ...routes(meFixture({ admin: ['users.read', 'users.manage'] })),
      'GET /api/v1/admin/users/u2': { status: 200, body: adminUserFixture() },
      'PATCH /api/v1/admin/users/u2': { status: 400, body: { error: 'validation', message: 'Self', details: { reason: 'self' } } },
    });
    mountApp('/admin/users/u2', server);
    fireEvent.click(await screen.findByRole('button', { name: 'Suspendre' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Suspendre' }));
    expect(await screen.findByText('Vous ne pouvez pas changer votre propre état.')).toBeTruthy();
  });

  it('personne inconnue : message dédié', async () => {
    mountApp('/admin/users/zz', fakeServer(routes()));
    expect(await screen.findByText('Cette personne n’existe pas')).toBeTruthy();
  });
});

describe('arabe : direction RTL', () => {
  it('pose dir=rtl sur <html> et traduit la coquille', async () => {
    const server = fakeServer({ 'GET /api/v1/instance': { status: 200, body: instanceInfo }, 'GET /api/v1/me': { status: 200, body: meFixture() } });
    const app = mountApp('/d/drive/recent', server, { lng: 'ar' });
    await screen.findByRole('navigation', { name: 'التنقّل' });
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
    await act(() => app.i18n.changeLanguage('fr'));
    expect(document.documentElement.dir).toBe('ltr');
  });
});
