import { Entity } from '@backstage/catalog-model';
import {
  getGithubProjectSlug,
  getSonarQubeProjectKey,
  isCodeQualityAvailable,
} from './annotations';

const entity = (annotations?: Record<string, string>): Entity => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: { name: 'x', annotations },
});

describe('annotations', () => {
  it('reads and trims the annotations', () => {
    const e = entity({
      'sonarqube.org/project-key': ' claims-api ',
      'github.com/project-slug': 'acme/claims-api',
    });
    expect(getSonarQubeProjectKey(e)).toBe('claims-api');
    expect(getGithubProjectSlug(e)).toBe('acme/claims-api');
    expect(isCodeQualityAvailable(e)).toBe(true);
  });

  it('treats missing or blank annotations as absent', () => {
    expect(isCodeQualityAvailable(entity())).toBe(false);
    expect(
      isCodeQualityAvailable(entity({ 'sonarqube.org/project-key': '  ' })),
    ).toBe(false);
  });
});
