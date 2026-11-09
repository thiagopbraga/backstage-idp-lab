import { HttpAuthService } from '@backstage/backend-plugin-api';
import { parseEntityRef, stringifyEntityRef } from '@backstage/catalog-model';
import { InputError } from '@backstage/errors';
import express from 'express';
import Router from 'express-promise-router';
import { z } from 'zod/v3';
import { CodeQualityService } from './service/CodeQualityService';

const reportQuery = z.object({
  entityRef: z.string().min(1, 'entityRef is required'),
});

export async function createRouter(options: {
  httpAuth: HttpAuthService;
  service: Pick<CodeQualityService, 'getReport'>;
}): Promise<express.Router> {
  const { httpAuth, service } = options;
  const router = Router();

  /**
   * GET /report?entityRef=component:default/claims-api
   * Users (frontend) and other backend plugins (service tokens) may call it.
   */
  router.get('/report', async (req, res) => {
    const parsed = reportQuery.safeParse(req.query);
    if (!parsed.success) {
      throw new InputError(parsed.error.issues.map(i => i.message).join('; '));
    }

    let entityRef: string;
    try {
      entityRef = stringifyEntityRef(
        parseEntityRef(parsed.data.entityRef, { defaultKind: 'component' }),
      );
    } catch (error) {
      throw new InputError(`Invalid entityRef "${parsed.data.entityRef}"`);
    }

    const credentials = await httpAuth.credentials(req, {
      allow: ['user', 'service'],
    });
    res.json(await service.getReport(entityRef, credentials));
  });

  return router;
}
