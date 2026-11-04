import { createFileRoute } from '@tanstack/react-router';
import { ExplorerRoute } from '../components/explorer/ExplorerRoute';
import { explorerSearch } from './-lib/schemas';

/*
 * Route splat unique de l'explorateur : racine, dossiers, fichiers et forme ~k.
 * La clé est lue par keyCodec.parse() sur le chemin BRUT de l'historique (ExplorerRoute).
 */
export const Route = createFileRoute('/d/$conn/b/$bucket/$')({
  validateSearch: explorerSearch,
  component: ExplorerRoute,
});
