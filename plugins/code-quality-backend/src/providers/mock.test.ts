import { MockGithubProvider, MockSonarQubeProvider } from './mock';

describe('mock providers', () => {
  it('are deterministic per project and marked as mock', async () => {
    const sonar = new MockSonarQubeProvider();
    const a = await sonar.getSummary('claims-api');
    expect(await sonar.getSummary('claims-api')).toEqual(a);
    expect(await sonar.getSummary('policy-quote-service')).not.toEqual(a);
    expect(sonar.source).toBe('mock');
    expect(['OK', 'WARN', 'ERROR']).toContain(a.qualityGate);
    expect(a.metrics.coverage).toBeGreaterThanOrEqual(45);
  });

  it('generates five recent workflow runs', async () => {
    const now = new Date('2026-11-09T12:00:00Z');
    const github = new MockGithubProvider(() => now);
    const summary = await github.getSummary('acme/claims-api');
    expect(summary.latestRuns).toHaveLength(5);
    expect(summary.url).toBe('https://github.com/acme/claims-api');
    for (const run of summary.latestRuns) {
      expect(new Date(run.createdAt).getTime()).toBeLessThan(now.getTime());
    }
    expect(await github.getSummary('acme/claims-api')).toEqual(summary);
  });
});
