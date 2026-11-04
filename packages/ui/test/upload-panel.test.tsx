import { fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { UploadPanel, formatRemaining, uploadErrorMessage, type UploadPanelItem } from '../src';
import { renderUi } from './render';

const sp = (s: string | null | undefined) => (s ?? '').replace(/[  ]/g, ' ');

/** Change la liste sans démonter le panneau (les annonces comparent avec l'état précédent). */
function Harness({ initial, next }: { initial: UploadPanelItem[]; next: UploadPanelItem[] }) {
  const [list, setList] = useState(initial);
  return (
    <>
      <button type="button" onClick={() => setList(next)}>
        next
      </button>
      <UploadPanel items={list} />
    </>
  );
}
const MB = 1_000_000;

const items: UploadPanelItem[] = [
  { id: 'a', name: 'rapport.pdf', folder: 'Mon drive / Docs', size: 10 * MB, sent: 4 * MB, state: 'uploading', speed: 2 * MB, remainingMs: 3000 * 60 },
  { id: 'b', name: 'photo.jpg', size: 2 * MB, sent: 0, state: 'paused' },
  { id: 'c', name: 'fini.txt', size: 1000, sent: 1000, state: 'done' },
  { id: 'd', name: 'gros.iso', size: 3_000 * MB, sent: 0, state: 'error', error: { code: 'quota_exceeded', retryable: false, details: { limit: 'user_quota', remaining: 312 * MB } } },
  { id: 'e', name: 'doublon.txt', size: 10, sent: 0, state: 'conflict', error: { code: 'already_exists' } },
];

describe('UploadPanel', () => {
  it('masqué sans envoi', () => {
    const { container } = renderUi(<UploadPanel items={[]} />);
    expect(container.querySelector('[data-slot="upload-panel"]')).toBeNull();
  });

  it('région nommée, résumé, barre globale et barres par fichier accessibles', () => {
    renderUi(<UploadPanel items={items} onPause={() => {}} onResume={() => {}} />, { lng: 'fr' });
    const region = screen.getByRole('region', { name: 'Transferts' });
    expect(sp(within(region).getByText(/en cours/, { selector: '[data-slot="upload-panel-summary"]' }).textContent)).toMatch(/^3 en cours · \d+ %/);
    expect(screen.getByRole('progressbar', { name: 'Progression globale' })).toBeTruthy();
    const bar = screen.getByRole('progressbar', { name: 'Progression de l’envoi de rapport.pdf' });
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
    expect(sp(bar.getAttribute('aria-valuetext'))).toBe('40 %, environ 3 min restantes');
    expect(screen.getByRole('button', { name: 'Mettre en pause l’envoi de rapport.pdf' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reprendre l’envoi de photo.jpg' })).toBeTruthy();
    expect(screen.getByText('Mon drive / Docs')).toBeTruthy();
    expect(sp(screen.getByText(/2 Mo\/s/).textContent)).toContain('2 Mo/s');
  });

  it('filtres : en cours, terminés, erreurs (avec le compte) ; erreur de quota traduite', () => {
    renderUi(<UploadPanel items={items} />, { lng: 'fr' });
    const errors = screen.getByRole('button', { name: 'Erreurs (1)' });
    expect(errors.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(errors);
    expect(errors.getAttribute('aria-pressed')).toBe('true');
    expect(sp(screen.getByText(/Espace insuffisant/).textContent)).toBe('Espace insuffisant : il reste 312 Mo');
    expect(screen.queryByText('rapport.pdf')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Terminés' }));
    expect(screen.getByText('fini.txt')).toBeTruthy();
    expect(screen.getByText('Envoyé')).toBeTruthy();
  });

  it('callbacks : pause, reprise, annulation, réessayer, conflit, tout mettre en pause, effacer', () => {
    const on = { onPause: vi.fn(), onResume: vi.fn(), onCancel: vi.fn(), onRetry: vi.fn(), onResolveConflict: vi.fn(), onPauseAll: vi.fn(), onClearFinished: vi.fn(), onShowInFolder: vi.fn() };
    renderUi(<UploadPanel items={items} {...on} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause upload of rapport.pdf' }));
    expect(on.onPause).toHaveBeenCalledWith('a');
    fireEvent.click(screen.getByRole('button', { name: 'Resume upload of photo.jpg' }));
    expect(on.onResume).toHaveBeenCalledWith('b');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel upload of rapport.pdf' }));
    expect(on.onCancel).toHaveBeenCalledWith('a');
    fireEvent.click(screen.getByRole('button', { name: 'Keep both' }));
    expect(on.onResolveConflict).toHaveBeenCalledWith('e', 'rename');
    fireEvent.click(screen.getByRole('button', { name: 'Pause all' }));
    expect(on.onPauseAll).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Errors (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry upload of gros.iso' }));
    expect(on.onRetry).toHaveBeenCalledWith('d');
    fireEvent.click(screen.getByRole('button', { name: 'Finished' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show fini.txt in its folder' }));
    expect(on.onShowInFolder).toHaveBeenCalledWith('c');
    fireEvent.click(screen.getByRole('button', { name: 'Clear finished' }));
    expect(on.onClearFinished).toHaveBeenCalled();
  });

  it('réduire et déplier : aria-expanded, liste masquée', () => {
    const onCollapsedChange = vi.fn();
    renderUi(<UploadPanel items={items} onCollapsedChange={onCollapsedChange} />);
    const toggle = screen.getByRole('button', { name: 'Collapse transfers' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
    const expand = screen.getByRole('button', { name: 'Expand transfers' });
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Pause upload of rapport.pdf' })).toBeNull();
    // Le résumé reste visible replié.
    expect(screen.getByText(/in progress/)).toBeTruthy();
  });

  it('annonce l’échec d’un envoi en région assertive', () => {
    const running: UploadPanelItem[] = [{ id: 'x', name: 'a.bin', size: 10, sent: 5, state: 'uploading' }];
    renderUi(<Harness initial={running} next={[{ ...running[0]!, state: 'error', error: { code: 'local.network', retryable: true } }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'next' }));
    expect(screen.getByRole('alert').textContent).toBe('Upload of a.bin failed');
  });

  it.each([
    ['en', 'Transfers', 'Not enough storage: 312 MB left'],
    ['fr', 'Transferts', 'Espace insuffisant : il reste 312 Mo'],
    ['es', 'Transferencias', 'Espacio insuficiente: quedan 312 MB'],
    ['de', 'Übertragungen', 'Nicht genug Speicher: noch 312 MB frei'],
    ['it', 'Trasferimenti', 'Spazio insufficiente: restano 312 MB'],
    ['pt', 'Transferências', 'Espaço insuficiente: restam 312 MB'],
    ['ar', 'عمليات النقل', null],
  ])('%s : région et message de quota', (lng, region, quota) => {
    renderUi(<UploadPanel items={items} filter="errors" />, { lng });
    expect(screen.getByRole('region', { name: region })).toBeTruthy();
    const row = document.querySelector('[data-slot="upload-row"][data-state="error"] [data-slot="upload-row-state"]')!;
    if (quota) expect(sp(row.textContent)).toBe(quota);
    else expect(row.textContent).toContain('المساحة غير كافية');
  });
});

describe('textes d’erreur et durées', () => {
  it('uploadErrorMessage : quota (personnel, espace), motifs, erreurs locales, repli', () => {
    expect(uploadErrorMessage({ code: 'quota_exceeded', details: { remaining: 5 } })).toEqual({ key: 'uploadError.quota_exceeded', remaining: 5 });
    expect(uploadErrorMessage({ code: 'quota_exceeded', details: { limit: 'space_quota', remaining: 0 } })).toEqual({ key: 'uploadError.space_quota', remaining: 0 });
    expect(uploadErrorMessage({ code: 'quota_exceeded' })).toEqual({ key: 'uploadError.quota_exceededNoValue' });
    expect(uploadErrorMessage({ code: 'not_found', reason: 'upload_gone' })).toEqual({ key: 'uploadError.upload_gone' });
    expect(uploadErrorMessage({ code: 'local.file_changed' })).toEqual({ key: 'uploadError.file_changed' });
    expect(uploadErrorMessage({ code: 'upstream_error' })).toEqual({ key: 'uploadError.generic' });
  });

  it('formatRemaining : secondes par 5, minutes arrondies au-dessus, heures', () => {
    expect(sp(formatRemaining(12_000, 'fr'))).toBe('15 s');
    expect(sp(formatRemaining(150_000, 'fr'))).toBe('3 min');
    expect(sp(formatRemaining(2 * 3600_000, 'en'))).toBe('2 hr');
  });
});
