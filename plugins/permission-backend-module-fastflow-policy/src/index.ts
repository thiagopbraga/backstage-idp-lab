/***/
/**
 * The fastflow-policy backend module for the permission plugin.
 *
 * @packageDocumentation
 */

export { permissionModuleFastflowPolicy as default } from './module';
export {
  FastFlowPermissionPolicy,
  DEFAULT_POLICY_OPTIONS,
} from './policy/FastFlowPermissionPolicy';
export type { FastFlowPolicyOptions } from './policy/FastFlowPermissionPolicy';
