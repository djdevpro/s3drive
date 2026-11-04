import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
  Avatar,
  Badge,
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Checkbox,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Input,
  Kbd,
  KbdGroup,
  Label,
  NavigationProvider,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Progress,
  Separator,
  Skeleton,
  Spinner,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Toaster,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  buttonVariants,
  toast,
} from '../src';
import { renderUi } from './render';

describe('Button', () => {
  it('variantes sobres : classes ud-btn-* et ghost sur --ud-menu-hover', () => {
    expect(buttonVariants({ variant: 'primary' })).toContain('ud-btn-primary');
    expect(buttonVariants({ variant: 'secondary' })).toContain('ud-btn-secondary');
    expect(buttonVariants({ variant: 'danger' })).toContain('ud-btn-danger');
    expect(buttonVariants({ variant: 'ghost' })).toContain('hover:bg-menu-hover');
    expect(buttonVariants({ size: 'sm' })).toContain('h-7');
    expect(buttonVariants({ size: 'md' })).toContain('h-8');
    expect(buttonVariants({ size: 'lg' })).toContain('h-10');
    // Focus visible opaque
    expect(buttonVariants()).toContain('focus-visible:outline-focus');
  });

  it('type button par défaut et clic transmis', () => {
    const onClick = vi.fn();
    renderUi(<Button onClick={onClick}>Enregistrer</Button>);
    const btn = screen.getByRole('button', { name: 'Enregistrer' });
    expect(btn).toHaveProperty('type', 'button');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('chargement : aria-busy, spinner, clics ignorés, libellé conservé', () => {
    const onClick = vi.fn();
    renderUi(
      <Button variant="primary" loading onClick={onClick}>
        Importer
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Importer' });
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.querySelector('[data-slot="spinner"]')).not.toBeNull();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('désactivé : reste focalisable (aria-disabled), clic ignoré', () => {
    const onClick = vi.fn();
    renderUi(
      <Button disabled onClick={onClick}>
        Partager
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Partager' });
    expect(btn.hasAttribute('disabled')).toBe(false);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    btn.focus();
    expect(document.activeElement).toBe(btn);
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('asChild : styles du bouton sur un lien', () => {
    renderUi(
      <Button asChild variant="primary">
        <a href="/x">Ouvrir</a>
      </Button>,
    );
    expect(screen.getByRole('link', { name: 'Ouvrir' }).className).toContain('ud-btn-primary');
  });
});

describe('IconButton', () => {
  it('nom accessible obligatoire et infobulle au focus', async () => {
    renderUi(
      <IconButton aria-label="Plus d’actions">
        <svg />
      </IconButton>,
    );
    const btn = screen.getByRole('button', { name: 'Plus d’actions' });
    expect(btn.hasAttribute('title')).toBe(false);
    fireEvent.focus(btn);
    expect(await screen.findByRole('tooltip')).toBeTruthy();
    fireEvent.keyDown(btn, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  });
});

describe('Input, Label, Checkbox, Switch', () => {
  it('champ étiqueté, bordure --ud-input-border, erreur', () => {
    renderUi(
      <>
        <Label htmlFor="n">Nom</Label>
        <Input id="n" aria-invalid placeholder="rapport.pdf" />
      </>,
    );
    const input = screen.getByLabelText('Nom');
    expect(input.className).toContain('border-input-border');
    expect(input.className).toContain('placeholder:text-text-2');
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('case à cocher : rôle, bascule au clic et à Espace', () => {
    const onChange = vi.fn();
    renderUi(<Checkbox aria-label="Sélectionner" onCheckedChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: 'Sélectionner' });
    expect(box.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(box);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(box.getAttribute('aria-checked')).toBe('true');
    expect(box.className).toContain('data-[state=checked]:bg-check');
  });

  it('case indéterminée : aria-checked="mixed"', () => {
    renderUi(<Checkbox aria-label="Tout" checked="indeterminate" />);
    expect(screen.getByRole('checkbox', { name: 'Tout' }).getAttribute('aria-checked')).toBe('mixed');
  });

  it('interrupteur : rôle switch', () => {
    renderUi(<Switch aria-label="Versioning" />);
    const sw = screen.getByRole('switch', { name: 'Versioning' });
    fireEvent.click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('true');
  });
});

describe('Dialog et AlertDialog', () => {
  it('dialogue : rôle, aria-modal, titre, Fermer traduit, Échap ferme et rend le focus', async () => {
    renderUi(
      <Dialog>
        <DialogTrigger>Ouvrir</DialogTrigger>
        <DialogContent>
          <DialogTitle>Renommer</DialogTitle>
          <DialogDescription>Nouveau nom</DialogDescription>
          <input aria-label="Nom" />
        </DialogContent>
      </Dialog>,
      { lng: 'fr' },
    );
    const trigger = screen.getByRole('button', { name: 'Ouvrir' });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Renommer' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('dir')).toBe('ltr');
    expect(within(dialog).getByRole('button', { name: 'Fermer' })).toBeTruthy();
    // Focus initial sur le premier champ (Radix FocusScope)
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('textbox', { name: 'Nom' })));
    fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('dialogue en arabe : dir="rtl" sur le contenu en portail', async () => {
    renderUi(
      <Dialog defaultOpen>
        <DialogContent>
          <DialogTitle>عنوان</DialogTitle>
          <DialogDescription>نص</DialogDescription>
        </DialogContent>
      </Dialog>,
      { lng: 'ar' },
    );
    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('dir')).toBe('rtl');
    expect(within(dialog).getByRole('button', { name: 'إغلاق' })).toBeTruthy();
  });

  it('confirmation : rôle alertdialog, focus sur Annuler, action destructive', async () => {
    const onConfirm = vi.fn();
    renderUi(
      <AlertDialog>
        <AlertDialogTrigger>Supprimer…</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle>Supprimer définitivement 3 versions ?</AlertDialogTitle>
          <AlertDialogDescription>Cette action est irréversible.</AlertDialogDescription>
          <AlertDialogCancel />
          <AlertDialogAction variant="danger" onClick={onConfirm}>
            Supprimer
          </AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>,
      { lng: 'fr' },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer…' }));
    const dialog = await screen.findByRole('alertdialog');
    const cancel = within(dialog).getByRole('button', { name: 'Annuler' });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    const action = within(dialog).getByRole('button', { name: 'Supprimer' });
    expect(action.className).toContain('ud-btn-danger');
    fireEvent.click(action);
    expect(onConfirm).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });
});

describe('DropdownMenu et ContextMenu', () => {
  function Menu({ onRename = () => {} }: { onRename?: () => void }) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onRename}>Renommer</DropdownMenuItem>
          <DropdownMenuItem>Déplacer</DropdownMenuItem>
          <DropdownMenuItem variant="destructive">Supprimer</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  it('clavier : Entrée ouvre, flèches parcourent, Entrée choisit', async () => {
    const onRename = vi.fn();
    renderUi(<Menu onRename={onRename} />);
    const trigger = screen.getByRole('button', { name: 'Actions' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const menu = await screen.findByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Renommer', 'Déplacer', 'Supprimer']);
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    // La tabulation itinérante de Radix déplace le focus au tick suivant
    fireEvent.keyDown(items[0] as HTMLElement, { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement).toBe(items[1]));
    fireEvent.keyDown(items[1] as HTMLElement, { key: 'ArrowUp' });
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    fireEvent.keyDown(items[0] as HTMLElement, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('Échap ferme et rend le focus au déclencheur ; flottant bordé', async () => {
    renderUi(<Menu />);
    const trigger = screen.getByRole('button', { name: 'Actions' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const menu = await screen.findByRole('menu');
    expect(menu.className).toContain('border-float-border');
    expect(menu.className).toContain('shadow-float');
    const destructive = within(menu).getByRole('menuitem', { name: 'Supprimer' });
    expect(destructive.getAttribute('data-variant')).toBe('destructive');
    fireEvent.keyDown(menu, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('RTL : le contenu du menu reçoit dir="rtl"', async () => {
    renderUi(<Menu />, { lng: 'ar' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Actions' }), { key: 'Enter' });
    expect((await screen.findByRole('menu')).getAttribute('dir')).toBe('rtl');
  });

  it('menu contextuel : clic droit ouvre, Échap ferme', async () => {
    const onOpen = vi.fn();
    renderUi(
      <ContextMenu>
        <ContextMenuTrigger>zone</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={onOpen}>Ouvrir</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    );
    fireEvent.contextMenu(screen.getByText('zone'), { clientX: 10, clientY: 10 });
    const menu = await screen.findByRole('menu');
    fireEvent.keyDown(menu, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });
});

describe('Tooltip et Popover', () => {
  it('infobulle : apparaît au focus, Échap la masque sans déplacer le focus', async () => {
    renderUi(
      <Tooltip>
        <TooltipTrigger>i</TooltipTrigger>
        <TooltipContent>Aide</TooltipContent>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'i' });
    trigger.focus();
    fireEvent.focus(trigger);
    const tip = await screen.findByRole('tooltip');
    expect(tip.textContent).toBe('Aide');
    fireEvent.keyDown(trigger, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('popover : ouvre au clic, flottant bordé, Échap ferme', async () => {
    renderUi(
      <Popover>
        <PopoverTrigger>Filtrer</PopoverTrigger>
        <PopoverContent aria-label="Filtres">contenu</PopoverContent>
      </Popover>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Filtrer' }));
    const dialog = await screen.findByRole('dialog', { name: 'Filtres' });
    expect(dialog.className).toContain('border-float-border');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('Tabs', () => {
  function T() {
    return (
      <Tabs defaultValue="a" activationMode="automatic">
        <TabsList aria-label="Réglages">
          <TabsTrigger value="a">Général</TabsTrigger>
          <TabsTrigger value="b">Accès</TabsTrigger>
        </TabsList>
        <TabsContent value="a">A</TabsContent>
        <TabsContent value="b">B</TabsContent>
      </Tabs>
    );
  }

  it('rôles tablist/tab/tabpanel et flèches du clavier', async () => {
    renderUi(<T />);
    const [a, b] = screen.getAllByRole('tab');
    expect(a?.getAttribute('aria-selected')).toBe('true');
    a?.focus();
    fireEvent.keyDown(a as HTMLElement, { key: 'ArrowRight' });
    await waitFor(() => expect(document.activeElement).toBe(b));
    await waitFor(() => expect(b?.getAttribute('aria-selected')).toBe('true'));
    expect(screen.getByRole('tabpanel').textContent).toBe('B');
  });

  it('RTL : ← avance vers l’onglet suivant', async () => {
    renderUi(<T />, { lng: 'ar' });
    const [a, b] = screen.getAllByRole('tab');
    a?.focus();
    fireEvent.keyDown(a as HTMLElement, { key: 'ArrowLeft' });
    await waitFor(() => expect(document.activeElement).toBe(b));
  });
});

describe('Toast', () => {
  it('toast() affiche dans la région traduite, Fermer le retire', async () => {
    renderUi(<Toaster />, { lng: 'fr' });
    expect(screen.getByRole('region', { name: /Notifications/ })).toBeTruthy();
    let id = '';
    act(() => {
      id = toast.success('Lien copié', { description: 'Dans le presse-papiers', duration: Infinity });
    });
    expect(id).toMatch(/^ud-toast-/);
    const item = await screen.findByText('Lien copié');
    const root = item.closest('[data-slot="toast"]') as HTMLElement;
    expect(root.getAttribute('data-tone')).toBe('success');
    expect(root.className).toContain('border-float-border');
    fireEvent.click(within(root).getByRole('button', { name: 'Fermer la notification' }));
    await waitFor(() => expect(screen.queryByText('Lien copié')).toBeNull());
  });

  it('action et fermeture programmée', async () => {
    const undo = vi.fn();
    renderUi(<Toaster />);
    act(() => {
      toast('Moved to trash', { id: 'trash', action: { label: 'Undo', onClick: undo }, duration: Infinity });
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(undo).toHaveBeenCalledOnce();
    act(() => toast.dismiss('trash'));
    await waitFor(() => expect(screen.queryByText('Moved to trash')).toBeNull());
  });
});

describe('Progress, Skeleton, Separator, Badge, Kbd, Avatar, Spinner', () => {
  it('progression : rôle progressbar, valeur, remplissage depuis le bord de début', () => {
    renderUi(<Progress value={40} aria-label="Envoi" tone="done" />);
    const bar = screen.getByRole('progressbar', { name: 'Envoi' });
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
    const fill = bar.querySelector('[data-slot="progress-indicator"]') as HTMLElement;
    expect(fill.style.transform).toBe('scaleX(0.4)');
    expect(fill.className).toContain('bg-progress-done');
    expect(fill.className).toContain('rtl:origin-right');
  });

  it('squelette décoratif, séparateur de colonne', () => {
    const { container } = renderUi(
      <>
        <Skeleton className="h-4" />
        <Separator strong orientation="vertical" />
      </>,
    );
    expect(container.querySelector('.ud-skeleton')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('[data-slot="separator"]')?.className).toContain('bg-pane-border');
  });

  it('badge à ton, Kbd en LTR', () => {
    renderUi(
      <>
        <Badge tone="warning">Public</Badge>
        <KbdGroup keys={['Ctrl', 'K']} />
        <Kbd>Esc</Kbd>
      </>,
    );
    expect(screen.getByText('Public').className).toContain('bg-tone-warning-bg');
    expect(screen.getByText('Esc').getAttribute('dir')).toBe('ltr');
    expect(screen.getByText('Ctrl').closest('[data-slot="kbd-group"]')?.textContent).toBe('Ctrl+K');
  });

  it('avatar : initiales, décoratif sans label', () => {
    const { container } = renderUi(<Avatar name="Ada Lovelace" />);
    expect(container.textContent).toBe('AL');
    expect(container.querySelector('[data-slot="avatar"]')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('spinner : statut traduit, texte « Toujours en cours… » après le délai', () => {
    vi.useFakeTimers();
    try {
      renderUi(<Spinner slowAfterMs={10_000} />, { lng: 'fr' });
      expect(screen.getByRole('status', { name: 'Chargement…' })).toBeTruthy();
      expect(screen.queryByText('Toujours en cours…')).toBeNull();
      act(() => vi.advanceTimersByTime(10_000));
      expect(screen.getByText('Toujours en cours…')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Breadcrumb et liens indépendants du routeur', () => {
  function Crumbs() {
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/d/drive/b/home/">Mon drive</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbEllipsis />
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>rapport (final)</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  it('repère nav traduit, page courante, segments isolés', () => {
    renderUi(<Crumbs />, { lng: 'fr' });
    const nav = screen.getByRole('navigation', { name: 'Fil d’Ariane' });
    expect(within(nav).getByText('rapport (final)').tagName).toBe('BDI');
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('rapport (final)');
    expect(within(nav).getByText('Afficher les dossiers masqués').className).toContain('sr-only');
  });

  it('clic simple → onNavigate ; Ctrl+clic et clic du milieu → navigateur', () => {
    const onNavigate = vi.fn();
    renderUi(
      <NavigationProvider onNavigate={onNavigate}>
        <Crumbs />
      </NavigationProvider>,
    );
    const link = screen.getByRole('link', { name: 'Mon drive' });
    expect(link.getAttribute('href')).toBe('/d/drive/b/home/');
    expect(fireEvent.click(link)).toBe(false); // preventDefault
    expect(onNavigate).toHaveBeenCalledWith('/d/drive/b/home/', expect.anything());
    expect(fireEvent.click(link, { ctrlKey: true })).toBe(true);
    expect(fireEvent.click(link, { button: 1 })).toBe(true);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});

describe('EmptyState', () => {
  it('titre de niveau 2 par défaut, visuel décoratif, actions', () => {
    renderUi(<EmptyState icon={<svg />} title="Aucun fichier" description="Déposez des fichiers ici." actions={<Button>Importer</Button>} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Aucun fichier' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Importer' })).toBeTruthy();
    expect(document.querySelector('[data-slot="empty-state-media"]')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('niveau de titre réglable, variante compacte', () => {
    renderUi(<EmptyState variant="compact" headingLevel={3} title="Vide" />);
    expect(screen.getByRole('heading', { level: 3, name: 'Vide' })).toBeTruthy();
  });
});
