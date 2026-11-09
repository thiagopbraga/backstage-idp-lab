import { LoggerService } from '@backstage/backend-plugin-api';
import { CodeQualityConfig } from '../config';
import { GithubClient } from './GithubClient';
import { MockGithubProvider, MockSonarQubeProvider } from './mock';
import { SonarQubeClient } from './SonarQubeClient';
import { FetchFn, GithubProvider, SonarQubeProvider } from './types';

/** Picks live or mock providers from config (see `codeQuality.mode`). */
export function createProviders(
  config: CodeQualityConfig,
  options: { logger: LoggerService; fetchFn?: FetchFn },
): { sonarqube: SonarQubeProvider; github: GithubProvider } {
  const { mode } = config;

  // SonarQube has no anonymous API worth showing for private projects, so
  // "live" without a token is a configuration error rather than a silent mock.
  if (mode === 'live' && !config.sonarqube.token) {
    throw new Error(
      'codeQuality.mode is "live" but codeQuality.sonarqube.token is not set',
    );
  }
  const sonarToken = mode === 'mock' ? undefined : config.sonarqube.token;
  const sonarqube: SonarQubeProvider = sonarToken
    ? new SonarQubeClient({
        baseUrl: config.sonarqube.baseUrl,
        token: sonarToken,
        fetchFn: options.fetchFn,
      })
    : new MockSonarQubeProvider();

  const githubLive =
    mode === 'live' || (mode === 'auto' && Boolean(config.github.token));
  const github: GithubProvider = githubLive
    ? new GithubClient({
        apiBaseUrl: config.github.apiBaseUrl,
        token: config.github.token,
        fetchFn: options.fetchFn,
      })
    : new MockGithubProvider();

  options.logger.info(
    `code-quality providers: sonarqube=${sonarqube.source} (${config.sonarqube.baseUrl}), github=${github.source} (${config.github.apiBaseUrl})`,
  );
  return { sonarqube, github };
}
