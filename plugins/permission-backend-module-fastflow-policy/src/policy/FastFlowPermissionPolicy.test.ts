import { mockCredentials, mockServices } from '@backstage/backend-test-utils';
import { Entity } from '@backstage/catalog-model';
import { permissionRules } from '@backstage/plugin-catalog-backend/alpha';
import {
  catalogEntityCreatePermission,
  catalogEntityDeletePermission,
  catalogEntityReadPermission,
  catalogEntityRefreshPermission,
  catalogLocationDeletePermission,
} from '@backstage/plugin-catalog-common/alpha';
import {
  AuthorizeResult,
  ConditionalPolicyDecision,
  createPermission,
  PermissionCondition,
  PermissionCriteria,
  PolicyDecision,
} from '@backstage/plugin-permission-common';
import { PolicyQueryUser } from '@backstage/plugin-permission-node';
import {
  actionExecutePermission,
  taskCancelPermission,
  taskCreatePermission,
  taskReadPermission,
  templateManagementPermission,
  templateParameterReadPermission,
  templateStepReadPermission,
} from '@backstage/plugin-scaffolder-common/alpha';
import { FastFlowPermissionPolicy } from './FastFlowPermissionPolicy';

// Mirrors examples/org.yaml: what signInWithCatalogUser puts in the token.
const directory: Record<string, string[]> = {
  'user:default/ana.souza': [
    'user:default/ana.souza',
    'group:default/claims-squad',
  ],
  'user:default/bruno.lima': [
    'user:default/bruno.lima',
    'group:default/policy-squad',
  ],
  'user:default/thiago.braga': [
    'user:default/thiago.braga',
    'group:default/fastflow',
  ],
  // Signed in but not a member of any team (e.g. a contractor not yet onboarded)
  'user:default/no.team': ['user:default/no.team'],
};

const userInfo = mockServices.userInfo.mock({
  getUserInfo: async credentials => {
    const userEntityRef = (credentials.principal as { userEntityRef: string })
      .userEntityRef;
    return {
      userEntityRef,
      ownershipEntityRefs: directory[userEntityRef] ?? [userEntityRef],
    };
  },
});

const policy = new FastFlowPermissionPolicy(userInfo);

function asUser(userEntityRef: string): PolicyQueryUser {
  return {
    credentials: mockCredentials.user(userEntityRef),
    info: { userEntityRef, ownershipEntityRefs: directory[userEntityRef] },
  };
}

const ana = asUser('user:default/ana.souza');
const bruno = asUser('user:default/bruno.lima');
const thiago = asUser('user:default/thiago.braga');
const noTeam = asUser('user:default/no.team');

const component = (name: string, owner: string): Entity => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: { name, namespace: 'default' },
  spec: { type: 'service', lifecycle: 'production', owner },
  relations: [{ type: 'ownedBy', targetRef: owner }],
});
const claimsApi = component('claims-api', 'group:default/claims-squad');
const policyQuoteService = component(
  'policy-quote-service',
  'group:default/policy-squad',
);

// Scaffolder action rules (HAS_ACTION_ID / HAS_STRING_PROPERTY) are not exported
// by the scaffolder backend, so they are mirrored here with the same semantics.
// The end-to-end behaviour is covered by scripts/smoke-permissions.sh.
type ActionResource = { action: string; input?: Record<string, unknown> };
const actionRules: Record<string, (r: ActionResource, p: any) => boolean> = {
  HAS_ACTION_ID: (r, { actionId }) => r.action === actionId,
  HAS_STRING_PROPERTY: (r, { key, value }) =>
    typeof r.input?.[key] === 'string' &&
    (value === undefined || r.input?.[key] === value),
};
const catalogRules: Record<string, (r: Entity, p: any) => boolean> =
  Object.fromEntries(
    Object.values(permissionRules).map(rule => [
      rule.name,
      (r: Entity, p: any) => rule.apply(r, p),
    ]),
  );

function evaluate<R>(
  criteria: PermissionCriteria<PermissionCondition>,
  resource: R,
  rules: Record<string, (r: R, p: any) => boolean>,
): boolean {
  if ('anyOf' in criteria) {
    return criteria.anyOf.some(c => evaluate(c, resource, rules));
  }
  if ('allOf' in criteria) {
    return criteria.allOf.every(c => evaluate(c, resource, rules));
  }
  if ('not' in criteria) {
    return !evaluate(criteria.not, resource, rules);
  }
  const rule = rules[criteria.rule];
  if (!rule) throw new Error(`unknown rule ${criteria.rule}`);
  return rule(resource, criteria.params);
}

function conditional(decision: PolicyDecision): ConditionalPolicyDecision {
  expect(decision.result).toBe(AuthorizeResult.CONDITIONAL);
  return decision as ConditionalPolicyDecision;
}

describe('FastFlowPermissionPolicy', () => {
  describe('catalog reads stay open', () => {
    it.each([ana, bruno, noTeam])('allows catalog.entity.read', async user => {
      await expect(
        policy.handle({ permission: catalogEntityReadPermission }, user),
      ).resolves.toEqual({ result: AuthorizeResult.ALLOW });
    });

    it('allows reading template parameters and steps', async () => {
      for (const permission of [
        templateParameterReadPermission,
        templateStepReadPermission,
      ]) {
        await expect(policy.handle({ permission }, bruno)).resolves.toEqual({
          result: AuthorizeResult.ALLOW,
        });
      }
    });

    it('allows permissions it does not know about (other plugins)', async () => {
      const permission = createPermission({
        name: 'search.query',
        attributes: { action: 'read' },
      });
      await expect(policy.handle({ permission }, ana)).resolves.toEqual({
        result: AuthorizeResult.ALLOW,
      });
    });
  });

  describe('sensitive catalog operations are conditional on ownership', () => {
    it.each([catalogEntityDeletePermission, catalogEntityRefreshPermission])(
      '%s uses isEntityOwner with the user ownership refs',
      async permission => {
        const decision = conditional(await policy.handle({ permission }, ana));
        expect(decision).toMatchObject({
          pluginId: 'catalog',
          resourceType: 'catalog-entity',
          conditions: {
            rule: 'IS_ENTITY_OWNER',
            params: {
              claims: ['user:default/ana.souza', 'group:default/claims-squad'],
            },
          },
        });
      },
    );

    it.each([catalogEntityDeletePermission, catalogEntityRefreshPermission])(
      '%s: owner group member matches, non-owner does not',
      async permission => {
        const anaDecision = conditional(
          await policy.handle({ permission }, ana),
        );
        expect(evaluate(anaDecision.conditions, claimsApi, catalogRules)).toBe(
          true,
        );
        expect(
          evaluate(anaDecision.conditions, policyQuoteService, catalogRules),
        ).toBe(false);

        const brunoDecision = conditional(
          await policy.handle({ permission }, bruno),
        );
        expect(
          evaluate(brunoDecision.conditions, claimsApi, catalogRules),
        ).toBe(false);
        expect(
          evaluate(brunoDecision.conditions, policyQuoteService, catalogRules),
        ).toBe(true);
      },
    );

    it('denies unregistering locations (not entity-scoped) to product teams', async () => {
      await expect(
        policy.handle({ permission: catalogLocationDeletePermission }, ana),
      ).resolves.toEqual({ result: AuthorizeResult.DENY });
    });

    it('lets team members register entities, but not users without a team', async () => {
      await expect(
        policy.handle({ permission: catalogEntityCreatePermission }, ana),
      ).resolves.toEqual({ result: AuthorizeResult.ALLOW });
      await expect(
        policy.handle({ permission: catalogEntityCreatePermission }, noTeam),
      ).resolves.toEqual({ result: AuthorizeResult.DENY });
    });
  });

  describe('scaffolder', () => {
    const validate = (owner?: string): ActionResource => ({
      action: 'fastflow:governance:validate',
      input: { name: 'claims-quote-api', ...(owner ? { owner } : {}) },
    });

    it('only lets team members create tasks', async () => {
      await expect(
        policy.handle({ permission: taskCreatePermission }, ana),
      ).resolves.toEqual({ result: AuthorizeResult.ALLOW });
      await expect(
        policy.handle({ permission: taskCreatePermission }, noTeam),
      ).resolves.toEqual({ result: AuthorizeResult.DENY });
    });

    it('runs the governance action only for the initiator own groups', async () => {
      const decision = conditional(
        await policy.handle({ permission: actionExecutePermission }, ana),
      );
      expect(decision).toMatchObject({
        pluginId: 'scaffolder',
        resourceType: 'scaffolder-action',
      });
      const can = (r: ActionResource) =>
        evaluate(decision.conditions, r, actionRules);

      expect(can(validate('group:default/claims-squad'))).toBe(true);
      expect(can(validate('claims-squad'))).toBe(true); // short form, default namespace
      expect(can(validate('group:default/policy-squad'))).toBe(false);
      expect(can(validate('policy-squad'))).toBe(false);
      expect(can(validate())).toBe(false); // missing owner
      // other actions are not owner-scoped
      expect(can({ action: 'fetch:template', input: {} })).toBe(true);
      expect(can({ action: 'fastflow:publish:local', input: {} })).toBe(true);
    });

    it('denies owner-scoped actions entirely to users without a team', async () => {
      const decision = conditional(
        await policy.handle({ permission: actionExecutePermission }, noTeam),
      );
      const can = (r: ActionResource) =>
        evaluate(decision.conditions, r, actionRules);
      expect(can(validate('group:default/claims-squad'))).toBe(false);
      expect(can({ action: 'fetch:template', input: {} })).toBe(true);
    });

    it('honours a custom list of owner-scoped actions', async () => {
      const custom = new FastFlowPermissionPolicy(userInfo, {
        platformAdminGroups: [],
        ownerScopedActions: [],
      });
      await expect(
        custom.handle({ permission: actionExecutePermission }, bruno),
      ).resolves.toEqual({ result: AuthorizeResult.ALLOW });
    });

    it.each([taskReadPermission, taskCancelPermission])(
      '%s is limited to tasks the user created',
      async permission => {
        const decision = conditional(await policy.handle({ permission }, ana));
        expect(decision.conditions).toEqual({
          rule: 'IS_TASK_OWNER',
          resourceType: 'scaffolder-task',
          params: { createdBy: ['user:default/ana.souza'] },
        });
      },
    );

    it('keeps template management with the platform team', async () => {
      await expect(
        policy.handle({ permission: templateManagementPermission }, ana),
      ).resolves.toEqual({ result: AuthorizeResult.DENY });
    });
  });

  describe('platform admin (break-glass)', () => {
    it.each([
      catalogEntityDeletePermission,
      catalogEntityRefreshPermission,
      catalogLocationDeletePermission,
      actionExecutePermission,
      taskReadPermission,
      templateManagementPermission,
    ])('allows %s to members of group:default/fastflow', async permission => {
      await expect(policy.handle({ permission }, thiago)).resolves.toEqual({
        result: AuthorizeResult.ALLOW,
      });
    });

    it('admin groups come from the options', async () => {
      const custom = new FastFlowPermissionPolicy(userInfo, {
        platformAdminGroups: ['group:default/claims-squad'],
        ownerScopedActions: ['fastflow:governance:validate'],
      });
      await expect(
        custom.handle({ permission: catalogLocationDeletePermission }, ana),
      ).resolves.toEqual({ result: AuthorizeResult.ALLOW });
      await expect(
        custom.handle({ permission: catalogLocationDeletePermission }, thiago),
      ).resolves.toEqual({ result: AuthorizeResult.DENY });
    });
  });

  describe('unauthenticated / unknown users', () => {
    it.each([
      catalogEntityReadPermission,
      catalogEntityDeletePermission,
      taskCreatePermission,
      actionExecutePermission,
    ])('denies %s without a user principal', async permission => {
      await expect(policy.handle({ permission })).resolves.toEqual({
        result: AuthorizeResult.DENY,
      });
    });

    it('a signed-in user outside the directory only owns itself', async () => {
      const ghost = asUser('user:default/ghost');
      const decision = conditional(
        await policy.handle(
          { permission: catalogEntityDeletePermission },
          ghost,
        ),
      );
      expect(evaluate(decision.conditions, claimsApi, catalogRules)).toBe(
        false,
      );
      await expect(
        policy.handle({ permission: taskCreatePermission }, ghost),
      ).resolves.toEqual({ result: AuthorizeResult.DENY });
    });
  });
});
