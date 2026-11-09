/*
 * Catalog "lint" executed in CI: the descriptors in examples/ are the source of
 * truth for the demo, so a broken owner reference or a missing governance
 * annotation must fail the pipeline instead of surfacing as a processing error
 * inside Backstage after deploy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseAllDocuments } from 'yaml';
import {
  Entity,
  componentEntityV1alpha1Validator,
  domainEntityV1alpha1Validator,
  groupEntityV1alpha1Validator,
  parseEntityRef,
  resourceEntityV1alpha1Validator,
  stringifyEntityRef,
  systemEntityV1alpha1Validator,
  userEntityV1alpha1Validator,
  apiEntityV1alpha1Validator,
} from '@backstage/catalog-model';

const repoRoot = path.resolve(__dirname, '../../..');
const files = [
  'examples/org.yaml',
  'examples/entities.yaml',
  'catalog-info.yaml',
];

const validators = [
  apiEntityV1alpha1Validator,
  componentEntityV1alpha1Validator,
  domainEntityV1alpha1Validator,
  groupEntityV1alpha1Validator,
  resourceEntityV1alpha1Validator,
  systemEntityV1alpha1Validator,
  userEntityV1alpha1Validator,
];

const GOVERNANCE_ANNOTATIONS = [
  'fastflow.io/tier',
  'fastflow.io/criticality',
  'fastflow.io/data-classification',
];

function loadEntities(): Entity[] {
  return files.flatMap(file =>
    parseAllDocuments(fs.readFileSync(path.join(repoRoot, file), 'utf8'))
      .map(doc => doc.toJS() as Entity | null)
      .filter((e): e is Entity => Boolean(e)),
  );
}

const entities = loadEntities();
const refs = new Set(entities.map(e => stringifyEntityRef(e)));

describe('sample catalog', () => {
  it('only contains schema-valid entities', async () => {
    for (const entity of entities) {
      const results = await Promise.all(validators.map(v => v.check(entity)));
      expect({
        ref: stringifyEntityRef(entity),
        known: results.some(Boolean),
      }).toEqual({ ref: stringifyEntityRef(entity), known: true });
    }
  });

  it('has unique entity refs', () => {
    expect(refs.size).toBe(entities.length);
  });

  it('is owned by at least two teams', () => {
    const owners = new Set(
      entities
        .map(e => (e.spec as { owner?: string } | undefined)?.owner)
        .filter(Boolean),
    );
    expect(owners.size).toBeGreaterThanOrEqual(2);
  });

  it.each(entities.filter(e => (e.spec as any)?.owner))(
    '$kind:$metadata.name is owned by an existing Group',
    entity => {
      const owner = parseEntityRef((entity.spec as { owner: string }).owner, {
        defaultKind: 'group',
      });
      expect(owner.kind.toLocaleLowerCase('en-US')).toBe('group');
      expect(refs).toContain(stringifyEntityRef(owner));
    },
  );

  it.each(entities.filter(e => e.kind === 'Component'))(
    'Component $metadata.name declares governance annotations',
    entity => {
      for (const key of GOVERNANCE_ANNOTATIONS) {
        expect(entity.metadata.annotations).toHaveProperty([key]);
      }
    },
  );

  it.each(entities.filter(e => e.kind === 'User'))(
    'User $metadata.name belongs to an existing Group',
    entity => {
      const memberOf = (entity.spec as { memberOf?: string[] }).memberOf ?? [];
      expect(memberOf.length).toBeGreaterThan(0);
      for (const group of memberOf) {
        const ref = stringifyEntityRef(
          parseEntityRef(group, { defaultKind: 'group' }),
        );
        expect(refs).toContain(ref);
      }
    },
  );
});
