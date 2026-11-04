import { useLocation, useRouter } from '@tanstack/react-router';
import { parse } from '../../lib/keys/keyCodec';
import { Placeholder } from './Placeholder';

// Page introuvable ; une URL d'explorateur que le routeur n'a pas pu décoder est traitée comme mal formée.
export function NotFound() {
  const router = useRouter();
  useLocation();
  const { pathname, search } = router.history.location;
  if (pathname.startsWith('/d/') && 'error' in parse(pathname, search)) {
    return <Placeholder view="malformed" values={{ path: pathname }} />;
  }
  return <Placeholder view="notFound" />;
}
