import { Entity } from '@backstage/catalog-model';

/** SonarQube/SonarCloud project key (same annotation as the community plugin). */
export const SONARQUBE_PROJECT_KEY_ANNOTATION = 'sonarqube.org/project-key';

/** GitHub `owner/repo` slug (same annotation as the GitHub plugins). */
export const GITHUB_PROJECT_SLUG_ANNOTATION = 'github.com/project-slug';

/** Returns the SonarQube project key declared by the entity, if any. */
export function getSonarQubeProjectKey(entity: Entity): string | undefined {
  return (
    entity.metadata.annotations?.[SONARQUBE_PROJECT_KEY_ANNOTATION]?.trim() ||
    undefined
  );
}

/** Returns the GitHub `owner/repo` slug declared by the entity, if any. */
export function getGithubProjectSlug(entity: Entity): string | undefined {
  return (
    entity.metadata.annotations?.[GITHUB_PROJECT_SLUG_ANNOTATION]?.trim() ||
    undefined
  );
}

/**
 * True when the entity has at least one annotation the code-quality plugin
 * understands. Used as the entity card filter in the frontend.
 */
export function isCodeQualityAvailable(entity: Entity): boolean {
  return Boolean(
    getSonarQubeProjectKey(entity) || getGithubProjectSlug(entity),
  );
}
