import { describe, expect, it } from 'vitest';
import { THEME_COLOR_TOKENS, THEME_IDS, THEMES, type ThemeId } from '../lib/themes';
import { contrast, declsFor, evalColor, parseBlocks, readStyle, stripComments, type Decls } from './css-eval.test-utils';
const tokensCss = readStyle('./tokens.css');
const indexCss = readStyle('./index.css');
const bridgeCss = readStyle('./bridges/universal-email.css');
const porcelain = readStyle('./themes/porcelain.css');
const graphite = readStyle('./themes/graphite.css');
const nord = readStyle('./themes/nord.css');
const rosePine = readStyle('./themes/rose-pine.css');
const catppuccin = readStyle('./themes/catppuccin.css');
const solarized = readStyle('./themes/solarized.css');
const sepia = readStyle('./themes/sepia.css');
const forest = readStyle('./themes/forest.css');
const ocean = readStyle('./themes/ocean.css');
const midnight = readStyle('./themes/midnight.css');

const THEME_CSS: Record<ThemeId, string> = {
  porcelain,
  graphite,
  nord,
  'rose-pine': rosePine,
  catppuccin,
  solarized,
  sepia,
  forest,
  ocean,
  midnight,
};

type Mode = 'light' | 'dark';
const MODES: Mode[] = ['light', 'dark'];

function themeDecls(id: ThemeId, mode: Mode): Decls {
  return declsFor(THEME_CSS[id], (sel) => sel.includes(`[data-theme='${id}']`) && sel.includes('.dark') === (mode === 'dark'));
}

/** Variables visibles sur <html> pour une variante : jetons dérivés (:root, .dark) puis collection. */
function variant(id: ThemeId, mode: Mode): Decls {
  const root = declsFor(tokensCss, (sel) => sel === ':root');
  const dark = mode === 'dark' ? declsFor(tokensCss, (sel) => sel === '.dark') : {};
  return { ...root, ...dark, ...themeDecls(id, mode) };
}

function color(vars: Decls, token: string) {
  const v = vars[token];
  if (v === undefined) throw new Error(`missing ${token}`);
  return evalColor(v, vars);
}

const cases = THEME_IDS.flatMap((id) => MODES.map((mode) => [id, mode] as const));

describe('collections de thèmes', () => {
  it.each(cases)('%s (%s) définit tous les jetons de collection', (id, mode) => {
    const decls = themeDecls(id, mode);
    const missing = THEME_COLOR_TOKENS.filter((t) => !decls[t]?.trim());
    expect(missing).toEqual([]);
  });

  it.each(cases)('%s (%s) remappe --input et --ring', (id, mode) => {
    const decls = themeDecls(id, mode);
    expect(decls['--input']).toBe('var(--ud-input-border)');
    expect(decls['--ring']).toBe('var(--ud-focus)');
  });

  it('porcelain s’applique sans data-theme', () => {
    const selectors = parseBlocks(porcelain).map((b) => b.selector);
    expect(selectors.some((s) => s.includes(':root:not([data-theme])') && !s.includes('.dark'))).toBe(true);
    expect(selectors.some((s) => s.includes(':root:not([data-theme]).dark'))).toBe(true);
  });

  it.each(cases)('%s (%s) : aperçu du registre identique au CSS', (id, mode) => {
    const def = THEMES.find((t) => t.id === id);
    const decls = themeDecls(id, mode);
    const actual = ['--ud-app', '--ud-sidebar', '--ud-panel', '--ud-text-1', '--ud-accent'].map((t) => decls[t]?.toLowerCase());
    expect(actual).toEqual([...(def?.preview[mode] ?? [])]);
  });

  it('index.css importe polices, les 10 collections et les jetons', () => {
    expect(indexCss).toContain("@import './fonts.css'");
    for (const id of THEME_IDS) expect(indexCss).toContain(`@import './themes/${id}.css'`);
    expect(indexCss).toContain("@import './tokens.css'");
    expect(stripComments(indexCss)).not.toMatch(/@import ['"]tailwindcss['"]/);
  });
});

describe('jetons dérivés', () => {
  it('chaque jeton référencé par @theme inline est défini', () => {
    const themeBlock = /@theme inline \{([\s\S]*?)\n\}/.exec(tokensCss)?.[1] ?? '';
    const refs = new Set([...themeBlock.matchAll(/var\((--ud-[\w-]+)\)/g)].map((m) => m[1] as string));
    expect(refs.size).toBeGreaterThan(50);
    for (const id of THEME_IDS) {
      for (const mode of MODES) {
        const vars = variant(id, mode);
        expect([...refs].filter((r) => !(r in vars)), `${id} ${mode}`).toEqual([]);
      }
    }
  });

  it('ajustements A25', () => {
    const root = declsFor(tokensCss, (s) => s === ':root');
    const dark = declsFor(tokensCss, (s) => s === '.dark');
    expect(root['--ud-float-border']).toBe('var(--ud-line)');
    expect(dark['--ud-float-border']).toBe('var(--ud-line-strong)');
    expect(root['--ud-focus']).toBe('var(--ud-accent-strong)');
    expect(root['--ud-input-border']).toBe('color-mix(in oklab, var(--ud-text-3) 70%, var(--ud-text-2))');
  });
});

describe('contrastes (WCAG 2.x, calculés)', () => {
  const surfaces = ['--ud-app', '--ud-panel', '--ud-sidebar', '--popover', '--muted'];

  it.each(cases)('%s (%s)', (id, mode) => {
    const vars = variant(id, mode);
    const failures: string[] = [];
    const check = (fg: string, bgs: string[], min: number) => {
      const f = color(vars, fg);
      for (const bg of bgs) {
        const b = color(vars, bg);
        if (!f || !b) throw new Error(`format non évaluable : ${fg} / ${bg}`);
        const ratio = contrast(f, b);
        if (ratio < min) failures.push(`${fg} / ${bg} = ${ratio.toFixed(2)} < ${min}`);
      }
    };
    check('--ud-text-1', surfaces, 4.5);
    check('--ud-text-2', ['--ud-app', '--ud-panel', '--ud-sidebar'], 4.5);
    check('--ud-input-border', surfaces, 3);
    check('--ud-focus', surfaces, 3);
    check('--ud-danger-text', ['--ud-app', '--ud-panel', '--ud-sidebar', '--popover'], 4.5);
    check('--ud-on-accent', ['--ud-accent'], 4.5);
    // --ud-focus doit être opaque : il se résout en couleur pleine
    expect(color(vars, '--ud-focus')).not.toBeNull();
    expect(failures).toEqual([]);
  });
});

describe('passerelle Universal Email', () => {
  const blocks = (sel: string) => declsFor(bridgeCss, (s) => s === sel);

  it.each([':root', '.dark'])('%s fait suivre chaque jeton de collection --ud-* au --ue-* correspondant', (sel) => {
    const decls = blocks(sel);
    const udTokens = THEME_COLOR_TOKENS.filter((t) => t.startsWith('--ud-'));
    for (const t of udTokens) {
      expect(decls[t], t).toMatch(new RegExp(`^var\\(${t.replace('--ud-', '--ue-')},`));
    }
  });

  it('importe les jetons dérivés mais aucune collection du Drive', () => {
    expect(bridgeCss).toContain("@import '../tokens.css'");
    expect(stripComments(bridgeCss)).not.toMatch(/themes\//);
  });

  it('valeurs de repli : sans UE, la passerelle donne les couleurs de porcelain', () => {
    for (const mode of MODES) {
      const root = declsFor(tokensCss, (s) => s === ':root');
      const dark = mode === 'dark' ? declsFor(tokensCss, (s) => s === '.dark') : {};
      const vars = { ...root, ...dark, ...blocks(':root'), ...(mode === 'dark' ? blocks('.dark') : {}) };
      const ref = variant('porcelain', mode);
      for (const t of ['--ud-app', '--ud-text-1', '--ud-focus', '--ud-input-border']) {
        expect(color(vars, t), `${mode} ${t}`).toEqual(color(ref, t));
      }
    }
  });
});
