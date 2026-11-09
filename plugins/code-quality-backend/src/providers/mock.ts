import {
  GithubSummary,
  QualityGateStatus,
  SonarQubeSummary,
} from '@internal/backstage-plugin-code-quality-common';
import { assertGithubSlug } from './http';
import { GithubProvider, SonarQubeProvider } from './types';

/**
 * Deterministic pseudo-random numbers derived from a string (FNV-1a + LCG),
 * so the same project always renders the same numbers across restarts.
 */
function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    state ^= seed.charCodeAt(i);
    state = Math.imul(state, 16777619) >>> 0;
  }
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const int = (rand: () => number, max: number) => Math.floor(rand() * (max + 1));

/** Offline SonarQube data: used when no token is configured. */
export class MockSonarQubeProvider implements SonarQubeProvider {
  readonly source = 'mock' as const;

  async getSummary(projectKey: string): Promise<SonarQubeSummary> {
    const rand = seededRandom(`sonar:${projectKey}`);
    const coverage = Math.round((45 + rand() * 50) * 10) / 10;
    const bugs = int(rand, 6);
    const vulnerabilities = int(rand, 3);
    let qualityGate: QualityGateStatus = 'OK';
    if (vulnerabilities > 1 || coverage < 60) qualityGate = 'ERROR';
    else if (bugs > 3) qualityGate = 'WARN';

    return {
      projectKey,
      dashboardUrl: `https://sonarqube.example.com/dashboard?id=${encodeURIComponent(
        projectKey,
      )}`,
      qualityGate,
      metrics: {
        coverage,
        bugs,
        vulnerabilities,
        codeSmells: int(rand, 120),
        securityHotspots: int(rand, 5),
        duplicatedLinesDensity: Math.round(rand() * 80) / 10,
      },
    };
  }
}

/** Offline GitHub data: used when no token is configured. */
export class MockGithubProvider implements GithubProvider {
  readonly source = 'mock' as const;

  constructor(private readonly now: () => Date = () => new Date()) {}

  async getSummary(slug: string): Promise<GithubSummary> {
    assertGithubSlug(slug);
    const rand = seededRandom(`github:${slug}`);
    const base = this.now().getTime();
    const workflows = ['CI', 'Deploy to staging', 'Deploy to production'];
    const conclusions = ['success', 'success', 'success', 'failure'];

    return {
      slug,
      url: `https://github.com/${slug}`,
      defaultBranch: 'main',
      visibility: 'private',
      openIssues: int(rand, 25),
      pushedAt: new Date(base - int(rand, 48) * 3_600_000).toISOString(),
      latestRuns: Array.from({ length: 5 }, (_, i) => {
        const id = 9_000_000_000 + int(rand, 999_999);
        const running = i === 0 && rand() < 0.3;
        return {
          id,
          name: workflows[int(rand, workflows.length - 1)],
          status: running ? 'in_progress' : 'completed',
          conclusion: running
            ? null
            : conclusions[int(rand, conclusions.length - 1)],
          branch: 'main',
          event: i % 2 === 0 ? 'push' : 'workflow_dispatch',
          createdAt: new Date(base - (i * 6 + 1) * 3_600_000).toISOString(),
          url: `https://github.com/${slug}/actions/runs/${id}`,
        };
      }),
    };
  }
}
