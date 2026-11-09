import { mockServices, startTestBackend } from '@backstage/backend-test-utils';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';
import request from 'supertest';
import { codeQualityPlugin } from './plugin';

const claimsApi = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: {
    name: 'claims-api',
    namespace: 'default',
    annotations: {
      'sonarqube.org/project-key': 'claims-api',
      'github.com/project-slug': 'acme/claims-api',
    },
  },
  spec: { type: 'service', owner: 'group:default/claims-squad' },
};

describe('code-quality plugin (integration)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('serves mock data offline when no tokens are configured', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const { server } = await startTestBackend({
      features: [
        codeQualityPlugin,
        catalogServiceMock.factory({ entities: [claimsApi] }),
      ],
    });

    const res = await request(server).get(
      '/api/code-quality/report?entityRef=component:default/claims-api',
    );

    expect(res.status).toBe(200);
    expect(res.body.sonarqube).toMatchObject({
      status: 'ok',
      source: 'mock',
      data: { projectKey: 'claims-api' },
    });
    expect(res.body.github).toMatchObject({ status: 'ok', source: 'mock' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('calls the SonarQube Web API when a token is configured', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async input => {
        const url = String(input);
        if (url.includes('project_status')) {
          return new Response(
            JSON.stringify({ projectStatus: { status: 'WARN' } }),
          );
        }
        return new Response(
          JSON.stringify({
            component: { measures: [{ metric: 'coverage', value: '72.5' }] },
          }),
        );
      });

    const { server } = await startTestBackend({
      features: [
        codeQualityPlugin,
        catalogServiceMock.factory({ entities: [claimsApi] }),
        mockServices.rootConfig.factory({
          data: {
            codeQuality: {
              sonarqube: {
                baseUrl: 'https://sonar.example.com',
                token: 'secret',
              },
            },
          },
        }),
      ],
    });

    const res = await request(server).get(
      '/api/code-quality/report?entityRef=component:default/claims-api',
    );

    expect(res.status).toBe(200);
    expect(res.body.sonarqube).toEqual({
      status: 'ok',
      source: 'live',
      data: {
        projectKey: 'claims-api',
        dashboardUrl: 'https://sonar.example.com/dashboard?id=claims-api',
        qualityGate: 'WARN',
        metrics: { coverage: 72.5 },
      },
    });
    expect(res.body.github.source).toBe('mock');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('returns 404 for entities that are not in the catalog', async () => {
    const { server } = await startTestBackend({
      features: [
        codeQualityPlugin,
        catalogServiceMock.factory({ entities: [] }),
      ],
    });
    const res = await request(server).get(
      '/api/code-quality/report?entityRef=component:default/ghost',
    );
    expect(res.status).toBe(404);
  });
});
