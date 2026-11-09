import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';
import { catalogServiceRef } from '@backstage/plugin-catalog-node';
import { readCodeQualityConfig } from './config';
import { createProviders } from './providers/factory';
import { createRouter } from './router';
import { CodeQualityService } from './service/CodeQualityService';

/**
 * code-quality backend plugin: aggregates SonarQube quality data and GitHub
 * repository/CI data for catalog entities. Mounted at /api/code-quality.
 *
 * @public
 */
export const codeQualityPlugin = createBackendPlugin({
  pluginId: 'code-quality',
  register(env) {
    env.registerInit({
      deps: {
        config: coreServices.rootConfig,
        logger: coreServices.logger,
        cache: coreServices.cache,
        httpAuth: coreServices.httpAuth,
        httpRouter: coreServices.httpRouter,
        catalog: catalogServiceRef,
      },
      async init({ config, logger, cache, httpAuth, httpRouter, catalog }) {
        const pluginConfig = readCodeQualityConfig(config);
        const providers = createProviders(pluginConfig, { logger });

        const service = new CodeQualityService({
          logger,
          cache,
          catalog,
          cacheTtlMs: pluginConfig.cacheTtlMs,
          ...providers,
        });

        httpRouter.use(await createRouter({ httpAuth, service }));
      },
    });
  },
});
