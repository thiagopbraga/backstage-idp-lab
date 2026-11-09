import { Config } from '@backstage/config';
import { ScmIntegrations } from '@backstage/integration';

export type CodeQualityMode = 'auto' | 'mock' | 'live';

export interface CodeQualityConfig {
  mode: CodeQualityMode;
  cacheTtlMs: number;
  sonarqube: { baseUrl: string; token?: string };
  github: { apiBaseUrl: string; host: string; token?: string };
}

const MODES: CodeQualityMode[] = ['auto', 'mock', 'live'];

/**
 * Reads `codeQuality.*`. The GitHub token is reused from `integrations.github`
 * (single place to rotate the secret) unless the plugin overrides it.
 */
export function readCodeQualityConfig(config: Config): CodeQualityConfig {
  const mode = (config.getOptionalString('codeQuality.mode') ??
    'auto') as CodeQualityMode;
  if (!MODES.includes(mode)) {
    throw new Error(
      `codeQuality.mode must be one of ${MODES.join(', ')}, got "${mode}"`,
    );
  }

  const apiBaseUrl =
    config.getOptionalString('codeQuality.github.apiBaseUrl') ??
    'https://api.github.com';
  const host =
    apiBaseUrl === 'https://api.github.com'
      ? 'github.com'
      : new URL(apiBaseUrl).host;
  const integrationToken =
    ScmIntegrations.fromConfig(config).github.byHost(host)?.config.token;

  return {
    mode,
    cacheTtlMs:
      (config.getOptionalNumber('codeQuality.cacheTtlSeconds') ?? 300) * 1000,
    sonarqube: {
      baseUrl:
        config.getOptionalString('codeQuality.sonarqube.baseUrl') ??
        'https://sonarcloud.io',
      token: config.getOptionalString('codeQuality.sonarqube.token'),
    },
    github: {
      apiBaseUrl,
      host,
      token:
        config.getOptionalString('codeQuality.github.token') ??
        integrationToken,
    },
  };
}
