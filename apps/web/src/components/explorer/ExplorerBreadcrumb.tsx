import { useRouter } from '@tanstack/react-router';
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@ud/ui';
import { ChevronLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { navigateHref } from '../../lib/keys/ExplorerLink';
import { explorerHref, type SearchValues } from './urls';

/*
 * Fil d'Ariane : depuis « Mon drive » ou le nom de
 * l'espace ; segments du milieu repliés dans « … » au-delà de quatre niveaux (l'espace et les
 * deux derniers restent visibles) ; en mobile, « ‹ parent ». Segments isolés (`<bdi>`).
 */

interface Crumb {
  label: string;
  href: string;
}

export interface ExplorerBreadcrumbProps {
  conn: string;
  bucket: string;
  prefix: string;
  rootLabel: string;
  search: SearchValues;
  mobile: boolean;
}

export function ExplorerBreadcrumb({ conn, bucket, prefix, rootLabel, search, mobile }: ExplorerBreadcrumbProps) {
  const { t } = useTranslation('explorer');
  const router = useRouter();
  const navigate = (href: string) => void navigateHref(router, href);
  const segments = prefix === '' ? [] : prefix.slice(0, -1).split('/');
  const crumbs: Crumb[] = [
    { label: rootLabel, href: explorerHref({ conn, bucket, key: '', kind: 'root' }, search) },
    ...segments.map((segment, index) => ({
      label: segment === '' ? t('unnamed') : segment,
      href: explorerHref({ conn, bucket, key: `${segments.slice(0, index + 1).join('/')}/`, kind: 'folder' }, search),
    })),
  ];
  const current = crumbs[crumbs.length - 1]!;

  if (mobile) {
    const parent = crumbs[crumbs.length - 2];
    return (
      <nav aria-label={t('breadcrumbs.label')} className="flex min-w-0 items-center gap-1">
        {parent && (
          <a
            href={parent.href}
            onClick={(event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey) return;
              event.preventDefault();
              navigate(parent.href);
            }}
            aria-label={t('breadcrumbs.up', { name: parent.label })}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-text-2 hover:bg-row-hover"
          >
            <ChevronLeft className="size-5 rtl:-scale-x-100" aria-hidden />
          </a>
        )}
        <h1 className="min-w-0 truncate text-xl" aria-current="page">
          <bdi>{current.label}</bdi>
        </h1>
      </nav>
    );
  }

  const collapse = crumbs.length > 4;
  const head = crumbs[0]!;
  const hidden = collapse ? crumbs.slice(1, -2) : [];
  const tail = collapse ? crumbs.slice(-2) : crumbs.slice(1);

  const link = (crumb: Crumb) => (
    <BreadcrumbLink href={crumb.href} onNavigate={(href) => navigate(href)} className="max-w-56 py-1 text-xl font-normal">
      {crumb.label}
    </BreadcrumbLink>
  );

  return (
    <Breadcrumb aria-label={t('breadcrumbs.label')} className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        <BreadcrumbItem className="min-w-0 shrink-0">
          {crumbs.length === 1 ? <h1 className="truncate px-1 py-1 text-xl"><BreadcrumbPage className="font-normal">{head.label}</BreadcrumbPage></h1> : link(head)}
        </BreadcrumbItem>
        {hidden.length > 0 && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <DropdownMenu>
                <DropdownMenuTrigger aria-label={t('breadcrumbs.more')} className="rounded-md px-1 py-1 hover:bg-row-hover">
                  <BreadcrumbEllipsis />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {hidden.map((crumb) => (
                    <DropdownMenuItem key={crumb.href} onSelect={() => navigate(crumb.href)}>
                      <bdi className="truncate">{crumb.label}</bdi>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </BreadcrumbItem>
          </>
        )}
        {tail.map((crumb, index) => (
          <BreadcrumbItemWithSep key={crumb.href}>
            {index === tail.length - 1 ? (
              <h1 className="min-w-0 truncate py-1 text-xl">
                <BreadcrumbPage className="font-normal">{crumb.label}</BreadcrumbPage>
              </h1>
            ) : (
              link(crumb)
            )}
          </BreadcrumbItemWithSep>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function BreadcrumbItemWithSep({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BreadcrumbSeparator />
      <BreadcrumbItem className="min-w-0">{children}</BreadcrumbItem>
    </>
  );
}
