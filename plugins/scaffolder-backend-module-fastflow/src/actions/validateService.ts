import { InputError } from '@backstage/errors';
import {
  parseEntityRef,
  stringifyEntityRef,
  CompoundEntityRef,
} from '@backstage/catalog-model';
import { CatalogService } from '@backstage/plugin-catalog-node';
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import {
  CRITICALITIES,
  DATA_CLASSIFICATIONS,
  DEFAULT_NAMING_POLICY,
  GOVERNANCE_ANNOTATIONS,
  NamingPolicy,
  TIERS,
  Violation,
  formatViolations,
  validateGovernanceFields,
  validateName,
} from '../governance/rules';

export const VALIDATE_SERVICE_ACTION_ID = 'fastflow:governance:validate';

/**
 * `fastflow:governance:validate` - runs FIRST in golden-path templates and
 * fails the task before any code is generated when a corporate rule is broken:
 *
 * 1. naming convention (kebab-case, length, allowed suffix) and the name must
 *    not already be taken by a Component in the catalog;
 * 2. owner must be an existing Group in the catalog;
 * 3. tier / criticality / data classification are mandatory and consistent.
 *
 * All violations are collected and reported at once (better UX than failing
 * on the first one). Catalog lookups use the credentials of the user running
 * the template, so they respect catalog read permissions.
 */
export function createValidateServiceAction(options: {
  catalog: CatalogService;
  namingPolicy?: NamingPolicy;
}) {
  const { catalog } = options;
  const namingPolicy = options.namingPolicy ?? DEFAULT_NAMING_POLICY;

  return createTemplateAction({
    id: VALIDATE_SERVICE_ACTION_ID,
    description:
      'Validates FastFlow governance rules (naming, owner group, tier, criticality, data classification) before code generation',
    examples: [
      {
        description: 'Validate a new service before fetch:template',
        example: [
          'steps:',
          '  - id: governance',
          '    name: Governance check',
          `    action: ${VALIDATE_SERVICE_ACTION_ID}`,
          '    input:',
          '      name: ${{ parameters.name }}',
          '      owner: ${{ parameters.owner }}',
          '      tier: ${{ parameters.tier }}',
          '      criticality: ${{ parameters.criticality }}',
          '      dataClassification: ${{ parameters.dataClassification }}',
        ].join('\n'),
      },
    ],
    schema: {
      input: {
        name: z =>
          z
            .string()
            .describe(
              `Component name, kebab-case ending with ${namingPolicy.allowedSuffixes.join(
                '/',
              )}`,
            ),
        owner: z =>
          z
            .string()
            .describe('Owner entity ref, e.g. group:default/claims-squad'),
        tier: z =>
          z
            .string()
            .optional()
            .describe(`One of: ${TIERS.join(', ')}`),
        criticality: z =>
          z
            .string()
            .optional()
            .describe(`One of: ${CRITICALITIES.join(', ')}`),
        dataClassification: z =>
          z
            .string()
            .optional()
            .describe(`One of: ${DATA_CLASSIFICATIONS.join(', ')}`),
        namespace: z =>
          z
            .string()
            .optional()
            .describe('Catalog namespace of the new component (default)'),
        checkNameAvailability: z =>
          z
            .boolean()
            .optional()
            .describe(
              'Fail when a Component with this name exists (default true)',
            ),
      },
      output: {
        componentRef: z => z.string().describe('component:<ns>/<name>'),
        owner: z => z.string().describe('Normalized owner group ref'),
        annotations: z =>
          z
            .record(z.string())
            .describe('fastflow.io/* annotations for catalog-info.yaml'),
      },
    },
    async handler(ctx) {
      const { input } = ctx;
      const namespace = input.namespace ?? 'default';
      const credentials = await ctx.getInitiatorCredentials();
      const violations: Violation[] = [
        ...validateName(input.name, namingPolicy),
        ...validateGovernanceFields(input),
      ];

      // --- owner must be an existing Group ---------------------------------
      let ownerRef: CompoundEntityRef | undefined;
      try {
        ownerRef = parseEntityRef(input.owner ?? '', {
          defaultKind: 'group',
          defaultNamespace: 'default',
        });
      } catch {
        violations.push({
          field: 'owner',
          message: `owner "${input.owner}" is not a valid entity reference`,
        });
      }
      if (ownerRef && ownerRef.kind.toLocaleLowerCase('en-US') !== 'group') {
        violations.push({
          field: 'owner',
          message: `owner must be a Group (team), got ${
            ownerRef.kind
          } "${stringifyEntityRef(ownerRef)}"`,
        });
        ownerRef = undefined;
      }
      if (ownerRef) {
        const group = await catalog.getEntityByRef(ownerRef, { credentials });
        if (!group) {
          violations.push({
            field: 'owner',
            message: `owner group "${stringifyEntityRef(
              ownerRef,
            )}" does not exist in the catalog`,
          });
        }
      }

      // --- name must be free ------------------------------------------------
      const nameIsValid = !violations.some(v => v.field === 'name');
      const componentRef = nameIsValid
        ? stringifyEntityRef({ kind: 'component', namespace, name: input.name })
        : `component:${namespace}/${input.name ?? ''}`;
      if (nameIsValid && input.checkNameAvailability !== false) {
        const existing = await catalog.getEntityByRef(componentRef, {
          credentials,
        });
        if (existing) {
          violations.push({
            field: 'name',
            message: `a Component named "${input.name}" already exists (${componentRef})`,
          });
        }
      }

      if (violations.length > 0) {
        const message = formatViolations(violations);
        ctx.logger.error(message);
        throw new InputError(message);
      }

      const owner = stringifyEntityRef(ownerRef!);
      ctx.logger.info(
        `Governance check passed for ${componentRef} (owner ${owner}, ${input.tier}, criticality ${input.criticality}, ${input.dataClassification})`,
      );
      ctx.output('componentRef', componentRef);
      ctx.output('owner', owner);
      ctx.output('annotations', {
        [GOVERNANCE_ANNOTATIONS.tier]: input.tier!,
        [GOVERNANCE_ANNOTATIONS.criticality]: input.criticality!,
        [GOVERNANCE_ANNOTATIONS.dataClassification]: input.dataClassification!,
      });
    },
  });
}
