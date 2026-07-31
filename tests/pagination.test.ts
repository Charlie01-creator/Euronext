import { parsePagination, paginatedResponse, resolveSort } from '../src/utils/pagination';

describe('parsePagination', () => {
  it('applies sensible defaults when no query params are given', () => {
    const result = parsePagination({});
    expect(result).toEqual({ page: 1, limit: 20, skip: 0, sortBy: undefined, sortOrder: 'desc' });
  });

  it('coerces string query params (as Express always provides) into numbers', () => {
    const result = parsePagination({ page: '3', limit: '5' });
    expect(result.page).toBe(3);
    expect(result.limit).toBe(5);
    expect(result.skip).toBe(10); // (3 - 1) * 5
  });

  it('caps the limit at 100 to prevent an unbounded query', () => {
    expect(() => parsePagination({ limit: '500' })).toThrow();
  });
});

describe('resolveSort', () => {
  const allowed = ['createdAt', 'amountUsd'];

  it('uses the requested field when it is on the allowlist', () => {
    const params = parsePagination({ sortBy: 'amountUsd', sortOrder: 'asc' });
    expect(resolveSort(params, allowed, 'createdAt')).toEqual({ amountUsd: 'asc' });
  });

  it('falls back to the default field when the requested one is not allowed', () => {
    // This matters for real reasons, not just correctness: sortBy eventually feeds a Prisma
    // orderBy clause, so silently accepting any string here would mean a caller could request
    // sorting by a column that doesn't exist (a confusing 500) or probe for field names.
    const params = parsePagination({ sortBy: 'passwordHash', sortOrder: 'desc' });
    expect(resolveSort(params, allowed, 'createdAt')).toEqual({ createdAt: 'desc' });
  });

  it('falls back when no sortBy is provided at all', () => {
    const params = parsePagination({});
    expect(resolveSort(params, allowed, 'createdAt')).toEqual({ createdAt: 'desc' });
  });
});

describe('paginatedResponse', () => {
  it('computes totalPages and hasMore correctly for a middle page', () => {
    const params = parsePagination({ page: '1', limit: '10' });
    const result = paginatedResponse(['a', 'b', 'c'], 25, params);
    expect(result.pagination.totalPages).toBe(3);
    expect(result.pagination.hasMore).toBe(true);
  });

  it('reports hasMore as false on the last page', () => {
    const params = parsePagination({ page: '3', limit: '10' });
    const result = paginatedResponse(['x'], 25, params);
    expect(result.pagination.hasMore).toBe(false);
  });
});
