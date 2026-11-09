/**
 * FastFlow governance rules for new software components.
 *
 * Pure functions (no I/O) so the rules are trivially unit-testable and can be
 * reused by other entry points (e.g. a catalog processor or a CI linter).
 * Catalog-dependent checks (owner exists, name not taken) live in the action.
 */

export const TIERS = ['tier-1', 'tier-2', 'tier-3'] as const;
export const CRITICALITIES = ['low', 'medium', 'high'] as const;
export const DATA_CLASSIFICATIONS = [
  'public',
  'internal',
  'confidential',
  'restricted',
] as const;

export type Tier = (typeof TIERS)[number];
export type Criticality = (typeof CRITICALITIES)[number];
export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];

/** Annotation keys already used by the sample catalog (examples/entities.yaml). */
export const GOVERNANCE_ANNOTATIONS = {
  tier: 'fastflow.io/tier',
  criticality: 'fastflow.io/criticality',
  dataClassification: 'fastflow.io/data-classification',
} as const;

export interface NamingPolicy {
  minLength: number;
  maxLength: number;
  /** The name must end with one of these suffixes, e.g. "-api". Empty = any. */
  allowedSuffixes: string[];
}

export const DEFAULT_NAMING_POLICY: NamingPolicy = {
  minLength: 3,
  maxLength: 40,
  allowedSuffixes: ['-api', '-service', '-worker', '-bff', '-web'],
};

const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export interface GovernanceInput {
  name?: string;
  tier?: string;
  criticality?: string;
  dataClassification?: string;
}

export interface Violation {
  field: 'name' | 'owner' | 'tier' | 'criticality' | 'dataClassification';
  message: string;
}

export function validateName(
  name: string | undefined,
  policy: NamingPolicy = DEFAULT_NAMING_POLICY,
): Violation[] {
  if (!name?.trim()) {
    return [{ field: 'name', message: 'name is required' }];
  }
  const violations: Violation[] = [];
  if (!KEBAB_CASE.test(name)) {
    violations.push({
      field: 'name',
      message: `name "${name}" must be kebab-case (lowercase letters, digits and single hyphens, starting with a letter)`,
    });
  }
  if (name.length < policy.minLength || name.length > policy.maxLength) {
    violations.push({
      field: 'name',
      message: `name "${name}" must have between ${policy.minLength} and ${policy.maxLength} characters (has ${name.length})`,
    });
  }
  if (
    policy.allowedSuffixes.length > 0 &&
    !policy.allowedSuffixes.some(suffix => name.endsWith(suffix))
  ) {
    violations.push({
      field: 'name',
      message: `name "${name}" must end with one of: ${policy.allowedSuffixes.join(
        ', ',
      )}`,
    });
  }
  return violations;
}

function validateEnum(
  field: Violation['field'],
  label: string,
  value: string | undefined,
  allowed: readonly string[],
): Violation[] {
  if (!value?.trim()) {
    return [
      {
        field,
        message: `${label} is mandatory (one of: ${allowed.join(', ')})`,
      },
    ];
  }
  if (!allowed.includes(value)) {
    return [
      {
        field,
        message: `${label} "${value}" is invalid (one of: ${allowed.join(
          ', ',
        )})`,
      },
    ];
  }
  return [];
}

/** Mandatory governance fields plus cross-field rules. */
export function validateGovernanceFields(input: GovernanceInput): Violation[] {
  const violations = [
    ...validateEnum('tier', 'tier', input.tier, TIERS),
    ...validateEnum(
      'criticality',
      'criticality',
      input.criticality,
      CRITICALITIES,
    ),
    ...validateEnum(
      'dataClassification',
      'data classification',
      input.dataClassification,
      DATA_CLASSIFICATIONS,
    ),
  ];
  if (violations.length > 0) {
    return violations;
  }

  // Cross-field rules (examples of how a regulated company encodes policy):
  if (input.tier === 'tier-1' && input.criticality !== 'high') {
    violations.push({
      field: 'criticality',
      message: 'tier-1 services must have criticality "high"',
    });
  }
  if (input.dataClassification === 'restricted' && input.tier === 'tier-3') {
    violations.push({
      field: 'tier',
      message:
        'services handling "restricted" data (e.g. personal data under LGPD) cannot be tier-3',
    });
  }
  return violations;
}

/** Formats violations as one human-readable error shown in the task log. */
export function formatViolations(violations: Violation[]): string {
  return [
    `FastFlow governance check failed (${violations.length} violation${
      violations.length === 1 ? '' : 's'
    }):`,
    ...violations.map(v => `  - [${v.field}] ${v.message}`),
  ].join('\n');
}
