import { mockCredentials, mockServices } from '@backstage/backend-test-utils';
import { NotFoundError } from '@backstage/errors';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';
import { Entity } from '@backstage/catalog-model';
import { GithubProvider, SonarQubeProvider } from '../providers';
import { CodeQualityService } from './CodeQualityService';

const entity = (name: string, annotations: Record<string, string>): Entity => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: { name, namespace: 'default', annotations },
  spec: { type: 'service', owner: 'group:default/claims-squad' },
});

const sonarSummary = {
  projectKey: 'claims-api',
  dashboardUrl: 'https://sonar/dashboard?id=claims-api',
  qualityGate: 'OK' as const,
  metrics: { coverage: 90 },
};

const githubSummary = {
  slug: 'acme/claims-api',
  url: 'https://github.com/acme/claims-api',
  defaultBranch: 'main',
  visibility: 'private',
  openIssues: 1,
  latestRuns: [],
};

function setup(entities: Entity[]) {
  const sonarqube: jest.Mocked<SonarQubeProvider> = {
    source: 'live',
    getSummary: jest.fn().mockResolvedValue(sonarSummary),
  };
  const github: jest.Mocked<GithubProvider> = {
    source: 'mock',
    getSummary: jest.fn().mockResolvedValue(githubSummary),
  };
  const logger = mockServices.logger.mock();
  const catalog = catalogServiceMock({ entities });
  const service = new CodeQualityService({
    logger,
    cache: mockServices.cache.mock({
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    }),
    catalog,
    sonarqube,
    github,
    cacheTtlMs: 60_000,
    now: () => new Date('2026-11-09T12:00:00Z'),
  });
  return { service, sonarqube, github, logger, catalog };
}

describe('CodeQualityService', () => {
  const credentials = mockCredentials.user('user:default/ana.souza');

  it('aggregates both providers based on entity annotations', async () => {
    const { service, sonarqube, github } = setup([
      entity('claims-api', {
        'sonarqube.org/project-key': 'claims-api',
        'github.com/project-slug': 'acme/claims-api',
      }),
    ]);

    const report = await service.getReport(
      'component:default/claims-api',
      credentials,
    );

    expect(report).toEqual({
      entityRef: 'component:default/claims-api',
      generatedAt: '2026-11-09T12:00:00.000Z',
      sonarqube: { status: 'ok', source: 'live', data: sonarSummary },
      github: { status: 'ok', source: 'mock', data: githubSummary },
    });
    expect(sonarqube.getSummary).toHaveBeenCalledWith('claims-api');
    expect(github.getSummary).toHaveBeenCalledWith('acme/claims-api');
  });

  it('reads the entity from the catalog with the caller credentials', async () => {
    const { service, catalog } = setup([
      entity('claims-api', { 'sonarqube.org/project-key': 'claims-api' }),
    ]);
    const spy = jest.spyOn(catalog, 'getEntityByRef');
    await service.getReport('component:default/claims-api', credentials);
    expect(spy).toHaveBeenCalledWith('component:default/claims-api', {
      credentials,
    });
  });

  it('marks sections without annotation as not-configured', async () => {
    const { service, sonarqube, github } = setup([
      entity('widget', { 'sonarqube.org/project-key': 'widget' }),
    ]);
    const report = await service.getReport(
      'component:default/widget',
      credentials,
    );
    expect(report.github).toEqual({ status: 'not-configured' });
    expect(report.sonarqube.status).toBe('ok');
    expect(sonarqube.getSummary).toHaveBeenCalledTimes(1);
    expect(github.getSummary).not.toHaveBeenCalled();
  });

  it('isolates provider failures per section and logs them', async () => {
    const { service, sonarqube, logger } = setup([
      entity('claims-api', {
        'sonarqube.org/project-key': 'claims-api',
        'github.com/project-slug': 'acme/claims-api',
      }),
    ]);
    sonarqube.getSummary.mockRejectedValue(
      new Error('SonarQube responded 503 Service Unavailable'),
    );

    const report = await service.getReport(
      'component:default/claims-api',
      credentials,
    );

    expect(report.sonarqube).toEqual({
      status: 'error',
      message: 'SonarQube responded 503 Service Unavailable',
    });
    expect(report.github.status).toBe('ok');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('sonarqube:live:claims-api'),
    );
  });

  it('throws NotFoundError for unknown entities', async () => {
    const { service } = setup([]);
    await expect(
      service.getReport('component:default/ghost', credentials),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('serves repeated requests from the cache', async () => {
    const store = new Map<string, unknown>();
    const cache = mockServices.cache.mock({
      get: jest.fn(async (key: string) => store.get(key) as any),
      set: jest.fn(async (key: string, value: unknown) => {
        store.set(key, value);
      }),
    });
    const sonarqube: jest.Mocked<SonarQubeProvider> = {
      source: 'live',
      getSummary: jest.fn().mockResolvedValue(sonarSummary),
    };
    const service = new CodeQualityService({
      logger: mockServices.logger.mock(),
      cache,
      catalog: catalogServiceMock({
        entities: [
          entity('claims-api', { 'sonarqube.org/project-key': 'claims-api' }),
        ],
      }),
      sonarqube,
      github: { source: 'mock', getSummary: jest.fn() },
      cacheTtlMs: 60_000,
    });

    await service.getReport('component:default/claims-api', credentials);
    const second = await service.getReport(
      'component:default/claims-api',
      credentials,
    );

    expect(sonarqube.getSummary).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith(
      'sonarqube:live:claims-api',
      sonarSummary,
      { ttl: 60_000 },
    );
    expect(second.sonarqube).toEqual({
      status: 'ok',
      source: 'live',
      data: sonarSummary,
    });
  });
});
