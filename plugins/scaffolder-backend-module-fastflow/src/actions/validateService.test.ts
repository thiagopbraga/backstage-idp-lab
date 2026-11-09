import { Entity } from '@backstage/catalog-model';
import { InputError } from '@backstage/errors';
import { mockCredentials } from '@backstage/backend-test-utils';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';
import { createMockActionContext } from '@backstage/plugin-scaffolder-node-test-utils';
import { createValidateServiceAction } from './validateService';

const group = (name: string): Entity => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Group',
  metadata: { name, namespace: 'default' },
  spec: { type: 'team', children: [] },
});

const existingComponent: Entity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: { name: 'claims-api', namespace: 'default' },
  spec: { type: 'service', lifecycle: 'production', owner: 'claims-squad' },
};

const validInput = {
  name: 'claims-intake-api',
  owner: 'group:default/claims-squad',
  tier: 'tier-2',
  criticality: 'medium',
  dataClassification: 'confidential',
};

function setup() {
  const catalog = catalogServiceMock({
    entities: [group('claims-squad'), group('policy-squad'), existingComponent],
  });
  const getEntityByRef = jest.spyOn(catalog, 'getEntityByRef');
  const action = createValidateServiceAction({ catalog });
  const credentials = mockCredentials.user('user:default/ana.souza');
  const run = (input: Record<string, unknown>) => {
    // createMockActionContext ignores some overrides, so set them explicitly
    const ctx = {
      ...createMockActionContext({ input: input as any }),
      getInitiatorCredentials: async () => credentials,
    };
    return { ctx, promise: action.handler(ctx) };
  };
  return { run, getEntityByRef, credentials };
}

describe('fastflow:governance:validate', () => {
  it('passes a valid payload and outputs normalized values', async () => {
    const { run, getEntityByRef, credentials } = setup();
    const { ctx, promise } = run(validInput);

    await expect(promise).resolves.toBeUndefined();
    expect(ctx.output).toHaveBeenCalledWith(
      'componentRef',
      'component:default/claims-intake-api',
    );
    expect(ctx.output).toHaveBeenCalledWith(
      'owner',
      'group:default/claims-squad',
    );
    expect(ctx.output).toHaveBeenCalledWith('annotations', {
      'fastflow.io/tier': 'tier-2',
      'fastflow.io/criticality': 'medium',
      'fastflow.io/data-classification': 'confidential',
    });
    // catalog is queried on behalf of the template initiator
    expect(getEntityByRef).toHaveBeenCalledWith(
      { kind: 'group', namespace: 'default', name: 'claims-squad' },
      { credentials },
    );
  });

  it('accepts a short owner ref and defaults kind to group', async () => {
    const { run } = setup();
    const result = run({ ...validInput, owner: 'policy-squad' });
    await expect(result.promise).resolves.toBeUndefined();
    expect(result.ctx.output).toHaveBeenCalledWith(
      'owner',
      'group:default/policy-squad',
    );
  });

  it('rejects a bad name before generating anything', async () => {
    const { run } = setup();
    const { promise, ctx } = run({ ...validInput, name: 'Claims_Intake' });
    await expect(promise).rejects.toThrow(InputError);
    await expect(promise).rejects.toThrow(/\[name\] .*must be kebab-case/);
    expect(ctx.output).not.toHaveBeenCalled();
  });

  it('rejects a name that already exists in the catalog', async () => {
    const { run } = setup();
    await expect(
      run({ ...validInput, name: 'claims-api' }).promise,
    ).rejects.toThrow(
      'a Component named "claims-api" already exists (component:default/claims-api)',
    );
  });

  it('rejects an unknown owner group', async () => {
    const { run } = setup();
    await expect(
      run({ ...validInput, owner: 'group:default/ghost-team' }).promise,
    ).rejects.toThrow(
      'owner group "group:default/ghost-team" does not exist in the catalog',
    );
  });

  it('rejects a missing owner and an owner that is not a Group', async () => {
    const { run } = setup();
    await expect(run({ ...validInput, owner: '' }).promise).rejects.toThrow(
      /\[owner\] owner "" is not a valid entity reference/,
    );
    await expect(
      run({ ...validInput, owner: 'user:default/ana.souza' }).promise,
    ).rejects.toThrow(/owner must be a Group \(team\), got user/);
  });

  it('rejects missing governance fields', async () => {
    const { run } = setup();
    const { promise } = run({ name: validInput.name, owner: validInput.owner });
    await expect(promise).rejects.toThrow(/\[tier\] tier is mandatory/);
    await expect(promise).rejects.toThrow(
      /\[criticality\] criticality is mandatory/,
    );
    await expect(promise).rejects.toThrow(
      /\[dataClassification\] data classification is mandatory/,
    );
  });

  it('reports all violations at once', async () => {
    const { run } = setup();
    await expect(
      run({
        name: 'BadName',
        owner: 'group:default/ghost-team',
        tier: 'gold',
      }).promise,
    ).rejects.toThrow(/FastFlow governance check failed \(6 violations\)/);
  });

  it('can skip the name availability check', async () => {
    const { run } = setup();
    await expect(
      run({ ...validInput, name: 'claims-api', checkNameAvailability: false })
        .promise,
    ).resolves.toBeUndefined();
  });
});
