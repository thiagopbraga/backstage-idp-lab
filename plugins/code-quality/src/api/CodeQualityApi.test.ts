import { CodeQualityClient } from './CodeQualityApi';

describe('CodeQualityClient', () => {
  const discoveryApi = {
    getBaseUrl: jest.fn(async () => 'http://backend/api/code-quality'),
  };

  it('resolves the plugin URL via discovery and encodes the entity ref', async () => {
    const report = { entityRef: 'component:default/claims-api' };
    const fetchApi = {
      fetch: jest.fn(async () => new Response(JSON.stringify(report))),
    };
    const client = new CodeQualityClient({ discoveryApi, fetchApi });

    await expect(
      client.getReport('component:default/claims-api'),
    ).resolves.toEqual(report);
    expect(discoveryApi.getBaseUrl).toHaveBeenCalledWith('code-quality');
    expect(fetchApi.fetch).toHaveBeenCalledWith(
      'http://backend/api/code-quality/report?entityRef=component%3Adefault%2Fclaims-api',
    );
  });

  it('throws a ResponseError on non-2xx responses', async () => {
    const fetchApi = {
      fetch: jest.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { name: 'NotFoundError', message: 'Entity not found' },
              response: { statusCode: 404 },
            }),
            {
              status: 404,
              statusText: 'Not Found',
              headers: { 'Content-Type': 'application/json' },
            },
          ),
      ),
    };
    const client = new CodeQualityClient({ discoveryApi, fetchApi });
    await expect(
      client.getReport('component:default/ghost'),
    ).rejects.toMatchObject({ name: 'ResponseError', statusCode: 404 });
  });
});
