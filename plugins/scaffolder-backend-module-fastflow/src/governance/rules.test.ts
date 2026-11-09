import {
  formatViolations,
  validateGovernanceFields,
  validateName,
} from './rules';

describe('validateName', () => {
  it.each([
    'claims-intake-api',
    'fraud-scoring-worker',
    'portal-bff',
    'abc-web',
  ])('accepts %p', name => expect(validateName(name)).toEqual([]));

  it.each([
    ['ClaimsApi', /kebab-case/],
    ['claims_api', /kebab-case/],
    ['claims--api', /kebab-case/],
    ['1claims-api', /kebab-case/],
    ['claims', /must end with one of: -api, -service/],
    [`${'a'.repeat(40)}-api`, /between 3 and 40 characters/],
  ])('rejects %p', (name, message) => {
    const violations = validateName(name);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.map(v => v.message).join('\n')).toMatch(message);
  });

  it('requires a name', () => {
    expect(validateName('  ')).toEqual([
      { field: 'name', message: 'name is required' },
    ]);
  });

  it('honours a custom naming policy', () => {
    expect(
      validateName('claims', {
        minLength: 3,
        maxLength: 10,
        allowedSuffixes: [],
      }),
    ).toEqual([]);
  });
});

describe('validateGovernanceFields', () => {
  const valid = {
    tier: 'tier-2',
    criticality: 'medium',
    dataClassification: 'internal',
  };

  it('accepts a consistent set of fields', () => {
    expect(validateGovernanceFields(valid)).toEqual([]);
  });

  it('reports every missing mandatory field', () => {
    expect(validateGovernanceFields({}).map(v => v.field)).toEqual([
      'tier',
      'criticality',
      'dataClassification',
    ]);
  });

  it('rejects values outside the allowed lists', () => {
    expect(
      validateGovernanceFields({ ...valid, tier: 'gold' })[0].message,
    ).toBe('tier "gold" is invalid (one of: tier-1, tier-2, tier-3)');
  });

  it('enforces cross-field rules', () => {
    expect(
      validateGovernanceFields({
        ...valid,
        tier: 'tier-1',
        criticality: 'low',
      }),
    ).toEqual([
      {
        field: 'criticality',
        message: 'tier-1 services must have criticality "high"',
      },
    ]);
    expect(
      validateGovernanceFields({
        tier: 'tier-3',
        criticality: 'low',
        dataClassification: 'restricted',
      })[0].field,
    ).toBe('tier');
  });

  it('formats violations for the task log', () => {
    expect(
      formatViolations([{ field: 'name', message: 'name is required' }]),
    ).toBe(
      'FastFlow governance check failed (1 violation):\n  - [name] name is required',
    );
  });
});
