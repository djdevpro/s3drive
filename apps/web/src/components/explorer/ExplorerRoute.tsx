import { useLocation, useRouter } from '@tanstack/react-router';
import { parentPrefix } from '@ud/contracts';
import { useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { navigateHref } from '../../lib/keys/ExplorerLink';
import { parse } from '../../lib/keys/keyCodec';
import { parseSearchStrings } from '../../lib/keys/search';
import { explorerSearch } from '../../routes/-lib/schemas';
import { Explorer } from './Explorer';
import { ErrorView } from './ExplorerStates';

/*
 * Écran de la route splat `/d/$conn/b/$bucket/$` : la clé est lue par
 * keyCodec.parse() sur le chemin BRUT de l'historique, jamais par params._splat. Un fichier
 * s'ouvre en aperçu sur son dossier parent : le dossier reste monté d'un fichier à l'autre.
 */

const BUCKET_WITHOUT_SLASH = /^\/d\/[^/]+\/b\/[^/]+$/;

export function ExplorerRoute() {
  const { t } = useTranslation('explorer');
  const router = useRouter();
  // Abonnement aux changements d'URL ; la valeur brute vient de l'historique.
  useLocation();
  const raw = router.history.location;
  const missingSlash = BUCKET_WITHOUT_SLASH.test(raw.pathname);

  // /d/$conn/b/$bucket → racine du bucket (replace). Un redirect() de beforeLoad boucle
  // dans le routeur 1.170 (même URL au '/' final près, voir ExplorerLink).
  useLayoutEffect(() => {
    if (missingSlash) void navigateHref(router, `${raw.pathname}/${raw.search}`, { replace: true });
  }, [missingSlash, raw.pathname, raw.search, router]);
  if (missingSlash) return null;

  const parsed = parse(raw.pathname, raw.search);
  if ('error' in parsed) {
    return (
      <div data-view="malformed" className="flex h-full flex-col">
        <ErrorView kind="error" detail={t('states.malformed')} />
      </div>
    );
  }
  const search = explorerSearch.parse(parseSearchStrings(raw.search));
  const prefix = parsed.kind === 'file' ? parentPrefix(parsed.key) : parsed.key;
  const previewKey = parsed.kind === 'file' ? parsed.key : null;

  return (
    <div
      className="h-full min-h-0"
      data-scroll-restoration-id="explorer"
      data-view={`explorer.${parsed.kind}`}
      data-explorer-key={parsed.key}
      {...(parsed.kind === 'file' && parsed.version !== undefined ? { 'data-explorer-version': parsed.version } : {})}
    >
      <Explorer
        key={`${parsed.conn}\u0000${parsed.bucket}\u0000${prefix}`}
        conn={parsed.conn}
        bucket={parsed.bucket}
        prefix={prefix}
        previewKey={previewKey}
        {...(search.view ? { view: search.view } : {})}
        {...(search.sort ? { sort: search.sort } : {})}
        {...(search.dir ? { dir: search.dir } : {})}
        {...(search.focus ? { focus: search.focus } : {})}
      />
    </div>
  );
}
