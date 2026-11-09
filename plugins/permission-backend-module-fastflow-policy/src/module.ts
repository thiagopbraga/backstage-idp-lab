import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';

export const permissionModuleFastflowPolicy = createBackendModule({
  pluginId: 'permission',
  moduleId: 'fastflow-policy',
  register(reg) {
    reg.registerInit({
      deps: { logger: coreServices.logger },
      async init({ logger }) {
        logger.info('Hello World!');
      },
    });
  },
});
