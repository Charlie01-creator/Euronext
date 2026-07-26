import { z } from 'zod';

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
}

export function parsePagination(query: unknown): PaginationParams {
  const { page, limit } = paginationQuerySchema.parse(query ?? {});
  return { page, limit, skip: (page - 1) * limit };
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
