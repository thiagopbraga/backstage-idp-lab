import os from 'node:os';
import path from 'node:path';
import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import { ScmIntegrations } from '@backstage/integration';
import { catalogServiceRef } from '@backstage/plugin-catalog-node';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';
import {
  createDispatchWorkflowAction,
  createPublishLocalAction,
  createValidateServiceAction,
} from './actions';
import { DEFAULT_NAMING_POLICY } from './governance/rules';

/**
 * Scaffolder module that contributes the FastFlow golden-path actions through
 * the scaffolder actions extension point (no fork / patch of the scaffolder).
 *
 * @public
 */
export const scaffolderModuleFastflow = createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'fastflow',
  register({ registerInit }) {
    registerInit({
      deps: {
        scaffolderActions: scaffolderActionsExtensionPoint,
        catalog: catalogServiceRef,
        config: coreServices.rootConfig,
        logger: coreServices.logger,
      },
      async init({ scaffolderActions, catalog, config, logger }) {
        const governance = config.getOptionalConfig('fastflow.governance');
        const namingPolicy = {
          minLength:
            governance?.getOptionalNumber('naming.minLength') ??
            DEFAULT_NAMING_POLICY.minLength,
          maxLength:
            governance?.getOptionalNumber('naming.maxLength') ??
            DEFAULT_NAMING_POLICY.maxLength,
          allowedSuffixes:
            governance?.getOptionalStringArray('naming.allowedSuffixes') ??
            DEFAULT_NAMING_POLICY.allowedSuffixes,
        };
        const outputDir =
          config.getOptionalString('fastflow.scaffolder.localOutputDir') ??
          path.join(os.tmpdir(), 'fastflow-golden-paths');

        scaffolderActions.addActions(
          createValidateServiceAction({ catalog, namingPolicy }),
          createDispatchWorkflowAction({
            integrations: ScmIntegrations.fromConfig(config),
          }),
          createPublishLocalAction({ outputDir }),
        );
        logger.info(
          `FastFlow scaffolder actions registered (local output: ${outputDir}, suffixes: ${namingPolicy.allowedSuffixes.join(
            ',',
          )})`,
        );
      },
    });
  },
});
