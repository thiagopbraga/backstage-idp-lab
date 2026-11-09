import { NotFoundError } from '@backstage/errors';
import { SonarQubeClient } from './SonarQubeClient';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('SonarQubeClient', () => {
  it('maps quality gate and measures from the Web API', async () => {
    const fetchFn = jest.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/qualitygates/project_status')) {
        return json({ projectStatus: { status: 'ERROR' } });
      }
      return json({
        component: {
          key: 'claims-api',
          measures: [
            { metric: 'coverage', value: '81.4' },
            { metric: 'bugs', value: '2' },
            { metric: 'vulnerabilities', value: '0' },
            { metric: 'code_smells', value: '37' },
            { metric: 'security_hotspots', value: '1' },
            { metric: 'duplicated_lines_density', value: '3.2' },
            { metric: 'unknown_metric', value: '9' },
          ],
        },
      });
    });

    const client = new SonarQubeClient({
      baseUrl: 'https://sonar.example.com/',
      token: 'sq-token',
      fetchFn: fetchFn as typeof fetch,
    });

    await expect(client.getSummary('claims-api')).resolves.toEqual({
      projectKey: 'claims-api',
      dashboardUrl: 'https://sonar.example.com/dashboard?id=claims-api',
      qualityGate: 'ERROR',
      metrics: {
        coverage: 81.4,
        bugs: 2,
        vulnerabilities: 0,
        codeSmells: 37,
        securityHotspots: 1,
        duplicatedLinesDensity: 3.2,
      },
    });

    const [gateUrl, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(gateUrl).toBe(
      'https://sonar.example.com/api/qualitygates/project_status?projectKey=claims-api',
    );
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('sq-token:').toString('base64')}`,
    );
    expect(String(fetchFn.mock.calls[1][0])).toContain(
      'metricKeys=coverage,bugs,vulnerabilities,code_smells,security_hotspots,duplicated_lines_density',
    );
  });

  it('url-encodes the project key', async () => {
    const fetchFn = jest.fn(async () =>
      json({ projectStatus: { status: 'OK' }, component: { measures: [] } }),
    );
    const client = new SonarQubeClient({
      baseUrl: 'https://sonar.example.com',
      token: 't',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await client.getSummary('acme:claims api');
    expect(String((fetchFn.mock.calls[0] as unknown[])[0])).toContain(
      'projectKey=acme%3Aclaims%20api',
    );
  });

  it('turns 404 into NotFoundError and other statuses into errors', async () => {
    const notFound = new SonarQubeClient({
      baseUrl: 'https://sonar.example.com',
      token: 't',
      fetchFn: (async () => json({}, 404)) as typeof fetch,
    });
    await expect(notFound.getSummary('nope')).rejects.toBeInstanceOf(
      NotFoundError,
    );

    const forbidden = new SonarQubeClient({
      baseUrl: 'https://sonar.example.com',
      token: 't',
      fetchFn: (async () =>
        new Response('', {
          status: 403,
          statusText: 'Forbidden',
        })) as typeof fetch,
    });
    await expect(forbidden.getSummary('x')).rejects.toThrow(
      'SonarQube responded 403 Forbidden',
    );
  });
});
