import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import { policyExtensionPoint } from '@backstage/plugin-permission-node/alpha';
import {
  DEFAULT_POLICY_OPTIONS,
  FastFlowPermissionPolicy,
} from './policy/FastFlowPermissionPolicy';

/**
 * Installs the FastFlow ownership policy on the permission plugin through the
 * policy extension point. Replaces the allow-all policy module.
 *
 * @public
 */
export const permissionModuleFastflowPolicy = createBackendModule({
  pluginId: 'permission',
  moduleId: 'fastflow-policy',
  register(reg) {
    reg.registerInit({
      deps: {
        policy: policyExtensionPoint,
        userInfo: coreServices.userInfo,
        config: coreServices.rootConfig,
        logger: coreServices.logger,
      },
      async init({ policy, userInfo, config, logger }) {
        const options = {
          platformAdminGroups:
            config.getOptionalStringArray(
              'fastflow.permission.platformAdminGroups',
            ) ?? DEFAULT_POLICY_OPTIONS.platformAdminGroups,
          ownerScopedActions:
            config.getOptionalStringArray(
              'fastflow.permission.ownerScopedActions',
            ) ?? DEFAULT_POLICY_OPTIONS.ownerScopedActions,
        };
        policy.setPolicy(new FastFlowPermissionPolicy(userInfo, options));
        logger.info(
          `FastFlow permission policy installed (platform admins: ${options.platformAdminGroups.join(
            ', ',
          )}; owner-scoped actions: ${options.ownerScopedActions.join(', ')})`,
        );
      },
    });
  },
});
