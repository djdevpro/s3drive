import { z } from 'zod';
import { APP_LIST_DEFAULT_LIMIT, APP_LIST_MAX_LIMIT } from './limits.js';

/** Page de liste : `nextCursor` vaut `null` en fin de liste. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().min(1).nullable(),
  });
}

export interface PaginationQueryOptions {
  defaultLimit?: number;
  maxLimit?: number;
}

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

/** Paramètres `?cursor=&limit=` ; défauts des listes applicatives (S3 : `S3_LIST_*`). */
export function paginationQuerySchema(options: PaginationQueryOptions = {}) {
  const maxLimit = options.maxLimit ?? APP_LIST_MAX_LIMIT;
  const defaultLimit = Math.min(options.defaultLimit ?? APP_LIST_DEFAULT_LIMIT, maxLimit);
  return z.object({
    cursor: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    limit: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(maxLimit).default(defaultLimit)),
  });
}

export type PaginationQuery = z.infer<ReturnType<typeof paginationQuerySchema>>;

/** Discriminant des éléments de liste S3 ; les formes complètes viennent avec leur lot. */
export const ENTRY_KINDS = ['folder', 'file'] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];
export const entryKindSchema = z.enum(ENTRY_KINDS);

export const entryDiscriminantSchema = z.looseObject({ kind: entryKindSchema });
