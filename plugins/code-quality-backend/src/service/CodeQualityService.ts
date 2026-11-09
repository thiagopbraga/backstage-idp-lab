import {
  BackstageCredentials,
  CacheService,
  LoggerService,
} from '@backstage/backend-plugin-api';
import { stringifyEntityRef } from '@backstage/catalog-model';
import { NotFoundError, isError } from '@backstage/errors';
import { CatalogService } from '@backstage/plugin-catalog-node';
import {
  CodeQualityReport,
  SectionResult,
  getGithubProjectSlug,
  getSonarQubeProjectKey,
} from '@internal/backstage-plugin-code-quality-common';
import { JsonValue } from '@backstage/types';
import { GithubProvider, SonarQubeProvider } from '../providers';

export interface CodeQualityServiceOptions {
  logger: LoggerService;
  cache: CacheService;
  catalog: CatalogService;
  sonarqube: SonarQubeProvider;
  github: GithubProvider;
  cacheTtlMs: number;
  now?: () => Date;
}

/**
 * Builds the code-quality report for one catalog entity.
 *
 * - The entity is read from the catalog ON BEHALF OF THE CALLER, so catalog
 *   read permissions also gate this endpoint (no data leaks for entities the
 *   user cannot see).
 * - Each provider result is cached independently (key = provider + project),
 *   which protects SonarQube/GitHub rate limits when many users open the
 *   same entity page.
 * - Provider failures are isolated per section and logged, never thrown.
 */
export class CodeQualityService {
  constructor(private readonly options: CodeQualityServiceOptions) {}

  async getReport(
    entityRef: string,
    credentials: BackstageCredentials,
  ): Promise<CodeQualityReport> {
    const { catalog, sonarqube, github } = this.options;

    const entity = await catalog.getEntityByRef(entityRef, { credentials });
    if (!entity) {
      throw new NotFoundError(`Entity ${entityRef} not found`);
    }

    const projectKey = getSonarQubeProjectKey(entity);
    const slug = getGithubProjectSlug(entity);

    const [sonarSection, githubSection] = await Promise.all([
      projectKey
        ? this.section(`sonarqube:${sonarqube.source}:${projectKey}`, () =>
            sonarqube.getSummary(projectKey),
          ).then(data => this.wrap(sonarqube.source, data))
        : Promise.resolve({ status: 'not-configured' as const }),
      slug
        ? this.section(`github:${github.source}:${slug}`, () =>
            github.getSummary(slug),
          ).then(data => this.wrap(github.source, data))
        : Promise.resolve({ status: 'not-configured' as const }),
    ]);

    return {
      entityRef: stringifyEntityRef(entity),
      generatedAt: (this.options.now?.() ?? new Date()).toISOString(),
      sonarqube: sonarSection as CodeQualityReport['sonarqube'],
      github: githubSection as CodeQualityReport['github'],
    };
  }

  private wrap<T>(
    source: 'live' | 'mock',
    result: { data: T } | { error: string },
  ): SectionResult<T> {
    return 'data' in result
      ? { status: 'ok', source, data: result.data }
      : { status: 'error', message: result.error };
  }

  private async section<T>(
    cacheKey: string,
    load: () => Promise<T>,
  ): Promise<{ data: T } | { error: string }> {
    const { cache, logger, cacheTtlMs } = this.options;
    const cached = await cache.get<JsonValue>(cacheKey);
    if (cached !== undefined) {
      return { data: cached as T };
    }
    try {
      const data = await load();
      await cache.set(cacheKey, data as unknown as JsonValue, {
        ttl: cacheTtlMs,
      });
      return { data };
    } catch (error) {
      const message = isError(error) ? error.message : String(error);
      logger.warn(`code-quality: failed to load ${cacheKey}: ${message}`);
      return { error: message };
    }
  }
}
