import { Entity } from '@backstage/catalog-model';
import { codeQualityPlugin } from './plugin';
import { isCodeQualityAvailable } from '@internal/backstage-plugin-code-quality-common';

describe('code-quality frontend plugin', () => {
  it('is a frontend plugin with the code-quality id', () => {
    expect(codeQualityPlugin.id).toBe('code-quality');
  });

  it('only targets entities with a supported annotation', () => {
    const base: Entity = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      metadata: { name: 'x' },
    };
    expect(isCodeQualityAvailable(base)).toBe(false);
    expect(
      isCodeQualityAvailable({
        ...base,
        metadata: {
          name: 'x',
          annotations: { 'github.com/project-slug': 'acme/x' },
        },
      }),
    ).toBe(true);
  });
});
