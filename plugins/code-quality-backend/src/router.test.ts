import {
  mockCredentials,
  mockErrorHandler,
  mockServices,
} from '@backstage/backend-test-utils';
import { NotFoundError } from '@backstage/errors';
import express from 'express';
import request from 'supertest';
import { createRouter } from './router';

describe('createRouter', () => {
  let app: express.Express;
  const getReport = jest.fn();

  beforeEach(async () => {
    getReport.mockReset();
    const router = await createRouter({
      httpAuth: mockServices.httpAuth(),
      service: { getReport },
    });
    app = express();
    app.use(router);
    app.use(mockErrorHandler());
  });

  it('returns the report for a normalized entity ref', async () => {
    getReport.mockResolvedValue({ entityRef: 'component:default/claims-api' });

    const res = await request(app).get('/report?entityRef=claims-api');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ entityRef: 'component:default/claims-api' });
    expect(getReport).toHaveBeenCalledWith(
      'component:default/claims-api',
      mockCredentials.user(),
    );
  });

  it('accepts service-to-service calls', async () => {
    getReport.mockResolvedValue({});
    const res = await request(app)
      .get('/report?entityRef=component:default/claims-api')
      .set('Authorization', mockCredentials.service.header());
    expect(res.status).toBe(200);
    expect(getReport.mock.calls[0][1].principal.type).toBe('service');
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app)
      .get('/report?entityRef=component:default/claims-api')
      .set('Authorization', mockCredentials.none.header());
    expect(res.status).toBe(401);
    expect(getReport).not.toHaveBeenCalled();
  });

  it('validates the entityRef query parameter', async () => {
    expect((await request(app).get('/report')).status).toBe(400);
    expect(
      (await request(app).get('/report?entityRef=component:default/')).status,
    ).toBe(400);
    expect(getReport).not.toHaveBeenCalled();
  });

  it('maps NotFoundError to 404', async () => {
    getReport.mockRejectedValue(new NotFoundError('nope'));
    const res = await request(app).get(
      '/report?entityRef=component:default/ghost',
    );
    expect(res.status).toBe(404);
  });
});
