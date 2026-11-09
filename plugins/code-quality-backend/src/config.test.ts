import { ConfigReader } from '@backstage/config';
import { mockServices } from '@backstage/backend-test-utils';
import { readCodeQualityConfig } from './config';
import { createProviders } from './providers/factory';

const logger = mockServices.logger.mock();

describe('readCodeQualityConfig / createProviders', () => {
  it('defaults to auto mode with mock providers when there are no tokens', () => {
    const cfg = readCodeQualityConfig(new ConfigReader({}));
    expect(cfg).toMatchObject({
      mode: 'auto',
      cacheTtlMs: 300_000,
      sonarqube: { baseUrl: 'https://sonarcloud.io' },
      github: { apiBaseUrl: 'https://api.github.com', host: 'github.com' },
    });
    const providers = createProviders(cfg, { logger });
    expect(providers.sonarqube.source).toBe('mock');
    expect(providers.github.source).toBe('mock');
  });

  it('reuses the GitHub token from integrations.github', () => {
    const cfg = readCodeQualityConfig(
      new ConfigReader({
        integrations: { github: [{ host: 'github.com', token: 'gh-int' }] },
        codeQuality: { sonarqube: { token: 'sq' } },
      }),
    );
    expect(cfg.github.token).toBe('gh-int');
    const providers = createProviders(cfg, { logger });
    expect(providers.sonarqube.source).toBe('live');
    expect(providers.github.source).toBe('live');
  });

  it('forces mock data in mock mode even with tokens', () => {
    const cfg = readCodeQualityConfig(
      new ConfigReader({
        codeQuality: {
          mode: 'mock',
          sonarqube: { token: 'sq' },
          github: { token: 'gh' },
        },
      }),
    );
    const providers = createProviders(cfg, { logger });
    expect(providers.sonarqube.source).toBe('mock');
    expect(providers.github.source).toBe('mock');
  });

  it('fails fast on live mode without a SonarQube token or invalid mode', () => {
    expect(() =>
      createProviders(
        readCodeQualityConfig(
          new ConfigReader({ codeQuality: { mode: 'live' } }),
        ),
        { logger },
      ),
    ).toThrow(/sonarqube.token/);
    expect(() =>
      readCodeQualityConfig(new ConfigReader({ codeQuality: { mode: 'x' } })),
    ).toThrow(/codeQuality.mode/);
  });
});
