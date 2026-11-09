import {
  DataSource,
  GithubSummary,
  SonarQubeSummary,
} from '@internal/backstage-plugin-code-quality-common';

/** Injectable fetch so clients can be unit tested without network access. */
export type FetchFn = typeof fetch;

export interface SonarQubeProvider {
  readonly source: DataSource;
  getSummary(projectKey: string): Promise<SonarQubeSummary>;
}

export interface GithubProvider {
  readonly source: DataSource;
  getSummary(slug: string): Promise<GithubSummary>;
}
