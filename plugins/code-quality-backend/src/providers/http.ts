import { InputError, NotFoundError } from '@backstage/errors';
import { FetchFn } from './types';

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * GET + JSON with a hard timeout. Upstream failures are turned into errors
 * that carry the upstream status but never the request headers (tokens).
 */
export async function getJson<T>(
  fetchFn: FetchFn,
  url: string,
  options: {
    headers: Record<string, string>;
    upstream: string;
    timeoutMs?: number;
  },
): Promise<T> {
  let response: Response;
  try {
    response = await fetchFn(url, {
      headers: { Accept: 'application/json', ...options.headers },
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    // Network errors / timeouts: undici only says "fetch failed", the useful
    // part (ECONNREFUSED, ENOTFOUND, TimeoutError) lives in error.cause.
    const cause = (error as { cause?: { code?: string; message?: string } })
      .cause;
    const detail =
      cause?.code ?? cause?.message ?? (error as Error).name ?? 'network error';
    throw new Error(`${options.upstream} unreachable (${detail})`);
  }
  if (response.status === 404) {
    throw new NotFoundError(`${options.upstream}: resource not found`);
  }
  if (!response.ok) {
    throw new Error(
      `${options.upstream} responded ${response.status} ${response.statusText}`.trim(),
    );
  }
  return (await response.json()) as T;
}

const GITHUB_SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** Rejects anything that is not `owner/repo`, so the slug cannot alter the API path. */
export function assertGithubSlug(slug: string): void {
  if (!GITHUB_SLUG.test(slug) || slug.includes('..')) {
    throw new InputError(`Invalid github.com/project-slug "${slug}"`);
  }
}
