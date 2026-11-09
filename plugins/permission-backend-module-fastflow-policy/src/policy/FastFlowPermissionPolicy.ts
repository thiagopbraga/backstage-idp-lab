import { parseEntityRef } from '@backstage/catalog-model';
import { UserInfoService } from '@backstage/backend-plugin-api';
import {
  catalogConditions,
  createCatalogConditionalDecision,
} from '@backstage/plugin-catalog-backend/alpha';
import {
  catalogEntityCreatePermission,
  catalogEntityDeletePermission,
  catalogEntityRefreshPermission,
  catalogIngestionManagePermission,
  catalogLocationCreatePermission,
  catalogLocationDeletePermission,
} from '@backstage/plugin-catalog-common/alpha';
import {
  AuthorizeResult,
  isPermission,
  PermissionCondition,
  PermissionCriteria,
  PolicyDecision,
} from '@backstage/plugin-permission-common';
import {
  PermissionPolicy,
  PolicyQuery,
  PolicyQueryUser,
} from '@backstage/plugin-permission-node';
import {
  createScaffolderActionConditionalDecision,
  createScaffolderTaskConditionalDecision,
  scaffolderActionConditions,
  scaffolderTaskConditions,
} from '@backstage/plugin-scaffolder-backend/alpha';
import {
  actionExecutePermission,
  RESOURCE_TYPE_SCAFFOLDER_ACTION,
  taskCancelPermission,
  taskCreatePermission,
  taskReadPermission,
  templateDryRunPermission,
  templateManagementPermission,
} from '@backstage/plugin-scaffolder-common/alpha';

/** @public */
export interface FastFlowPolicyOptions {
  /** Members of these groups bypass the ownership rules (platform admin / break-glass). */
  platformAdminGroups: string[];
  /** Scaffolder actions whose `owner` input must be one of the initiator's groups. */
  ownerScopedActions: string[];
}

/** @public */
export const DEFAULT_POLICY_OPTIONS: FastFlowPolicyOptions = {
  platformAdminGroups: ['group:default/fastflow'],
  ownerScopedActions: ['fastflow:governance:validate'],
};

const allow: PolicyDecision = { result: AuthorizeResult.ALLOW };
const deny: PolicyDecision = { result: AuthorizeResult.DENY };

/** Only the identity fields the policy needs (resolved from the user's token). */
interface Identity {
  userEntityRef: string;
  ownershipEntityRefs: string[];
}

type NonEmpty<T> = [T, ...T[]];

function nonEmpty<T>(items: T[]): NonEmpty<T> | undefined {
  return items.length > 0 ? (items as NonEmpty<T>) : undefined;
}

function isGroupRef(ref: string): boolean {
  try {
    return parseEntityRef(ref).kind.toLocaleLowerCase('en-US') === 'group';
  } catch {
    return false;
  }
}

/**
 * FastFlow ownership-based permission policy.
 *
 * - Reads stay open (catalog browse, template forms, unknown read-like permissions).
 * - Destructive catalog operations are CONDITIONAL on `isEntityOwner`, so the
 *   catalog itself evaluates ownership (user + groups from `memberOf`), both for
 *   single-entity checks and for list filtering.
 * - Scaffolder: only team members can create tasks; owner-scoped actions only run
 *   when their `owner` input is one of the initiator's groups; tasks are visible
 *   and cancellable only by whoever created them.
 * - Platform admins (group:default/fastflow by default) are allowed everything.
 *
 * @public
 */
export class FastFlowPermissionPolicy implements PermissionPolicy {
  private readonly platformAdminGroups: Set<string>;

  constructor(
    private readonly userInfo: UserInfoService,
    private readonly options: FastFlowPolicyOptions = DEFAULT_POLICY_OPTIONS,
  ) {
    this.platformAdminGroups = new Set(
      options.platformAdminGroups.map(ref => ref.toLocaleLowerCase('en-US')),
    );
  }

  async handle(
    request: PolicyQuery,
    user?: PolicyQueryUser,
  ): Promise<PolicyDecision> {
    // No user principal (anonymous / "none"): nothing is allowed. Backend-to-backend
    // calls with service credentials never reach the policy (they are trusted).
    if (!user) {
      return deny;
    }
    const identity = await this.resolveIdentity(user);
    const { permission } = request;

    // Platform admin / break-glass: members of the platform team can administer
    // every entity and template. Every use is still audit-logged by the plugins.
    if (
      identity.ownershipEntityRefs.some(ref =>
        this.platformAdminGroups.has(ref.toLocaleLowerCase('en-US')),
      )
    ) {
      return allow;
    }

    const groups = identity.ownershipEntityRefs.filter(isGroupRef);
    const isTeamMember = groups.length > 0;

    // --- Catalog ----------------------------------------------------------
    if (
      isPermission(permission, catalogEntityDeletePermission) ||
      isPermission(permission, catalogEntityRefreshPermission)
    ) {
      return createCatalogConditionalDecision(
        permission,
        catalogConditions.isEntityOwner({
          claims: identity.ownershipEntityRefs,
        }),
      );
    }
    if (
      isPermission(permission, catalogLocationDeletePermission) ||
      isPermission(permission, catalogIngestionManagePermission)
    ) {
      // Not entity-scoped: unregistering a location removes every entity it
      // emits (possibly owned by other teams), so it is a platform operation.
      return deny;
    }
    if (
      isPermission(permission, catalogEntityCreatePermission) ||
      isPermission(permission, catalogLocationCreatePermission)
    ) {
      return isTeamMember ? allow : deny;
    }

    // --- Scaffolder -------------------------------------------------------
    if (
      isPermission(permission, taskCreatePermission) ||
      isPermission(permission, templateDryRunPermission)
    ) {
      return isTeamMember ? allow : deny;
    }
    if (isPermission(permission, templateManagementPermission)) {
      return deny;
    }
    if (isPermission(permission, actionExecutePermission)) {
      const criteria = this.actionCriteria(groups);
      return criteria
        ? createScaffolderActionConditionalDecision(permission, criteria)
        : allow;
    }
    if (
      isPermission(permission, taskReadPermission) ||
      isPermission(permission, taskCancelPermission)
    ) {
      return createScaffolderTaskConditionalDecision(
        permission,
        scaffolderTaskConditions.isTaskOwner({
          createdBy: [identity.userEntityRef],
        }),
      );
    }

    // Everything else (catalog.entity.read, template parameter/step read,
    // search, techdocs, ...) stays allowed so teams can browse each other's
    // services. Default-allow keeps third-party plugins working; switch this to
    // deny once every plugin in use has explicit rules.
    return allow;
  }

  /**
   * Any action may run, except owner-scoped actions whose `owner` input is not
   * one of the initiator's groups (full ref or, in the default namespace, the
   * short name the EntityPicker / API callers may send).
   */
  private actionCriteria(
    groups: string[],
  ):
    | PermissionCriteria<
        PermissionCondition<typeof RESOURCE_TYPE_SCAFFOLDER_ACTION>
      >
    | undefined {
    const scopedActions = nonEmpty(
      this.options.ownerScopedActions.map(actionId =>
        scaffolderActionConditions.hasActionId({ actionId }),
      ),
    );
    if (!scopedActions) {
      return undefined; // nothing is owner-scoped
    }
    const notOwnerScoped = { not: { anyOf: scopedActions } };
    const ownedBy = nonEmpty(
      groups
        .flatMap(ref => {
          const { namespace, name } = parseEntityRef(ref);
          return namespace === 'default' ? [ref, name] : [ref];
        })
        .map(value =>
          scaffolderActionConditions.hasStringProperty({ key: 'owner', value }),
        ),
    );
    if (!ownedBy) {
      return notOwnerScoped;
    }
    return { anyOf: [notOwnerScoped, { anyOf: ownedBy }] };
  }

  private async resolveIdentity(user: PolicyQueryUser): Promise<Identity> {
    const info = await this.userInfo.getUserInfo(user.credentials);
    return {
      userEntityRef: info.userEntityRef,
      ownershipEntityRefs: info.ownershipEntityRefs,
    };
  }
}
