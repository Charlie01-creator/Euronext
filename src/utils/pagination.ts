import { z } from 'zod';

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
  sortBy?: string;
  sortOrder: 'asc' | 'desc';
}

export function parsePagination(query: unknown): PaginationParams {
  const { page, limit, sortBy, sortOrder } = paginationQuerySchema.parse(query ?? {});
  return { page, limit, skip: (page - 1) * limit, sortBy, sortOrder };
}

/**
 * Turns a validated sort request into a Prisma orderBy clause, restricted to an allowlist of real
 * column names for the resource being queried. Never pass the raw query-string field straight
 * into orderBy — Prisma will happily accept any string key, so an unvalidated sortBy would let a
 * caller request a sort on a column that doesn't exist (a confusing 500) or, in principle, probe
 * for field names that shouldn't be exposed at all.
 */
export function resolveSort(params: PaginationParams, allowedFields: string[], fallback: string) {
  const field = params.sortBy && allowedFields.includes(params.sortBy) ? params.sortBy : fallback;
  return { [field]: params.sortOrder };
}

export function paginatedResponse<T>(items: T[], total: number, params: PaginationParams) {
  return {
    items,
    pagination: {
      page: params.page,
      limit: params.limit,
      total,
      totalPages: Math.ceil(total / params.limit),
      hasMore: params.page * params.limit < total,
    },
  };
}
