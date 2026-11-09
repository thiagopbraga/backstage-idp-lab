/**
 * Where the data came from. `mock` is returned when no token is configured
 * (offline demo) or when `codeQuality.mode` is forced to `mock`.
 */
export type DataSource = 'live' | 'mock';

/** Result of one provider for one entity, so a SonarQube outage never hides GitHub data. */
export type SectionResult<T> =
  | { status: 'ok'; source: DataSource; data: T }
  | { status: 'not-configured' }
  | { status: 'error'; message: string };

export type QualityGateStatus = 'OK' | 'WARN' | 'ERROR' | 'NONE';

export interface SonarQubeMetrics {
  /** Line + branch coverage in percent. */
  coverage?: number;
  bugs?: number;
  vulnerabilities?: number;
  codeSmells?: number;
  securityHotspots?: number;
  duplicatedLinesDensity?: number;
}

export interface SonarQubeSummary {
  projectKey: string;
  dashboardUrl: string;
  qualityGate: QualityGateStatus;
  metrics: SonarQubeMetrics;
}

export interface GithubWorkflowRun {
  id: number;
  name: string;
  /** queued | in_progress | completed ... */
  status: string;
  /** success | failure | cancelled ... (null while running) */
  conclusion: string | null;
  branch: string;
  event: string;
  createdAt: string;
  url: string;
}

export interface GithubSummary {
  slug: string;
  url: string;
  defaultBranch: string;
  visibility: string;
  openIssues: number;
  pushedAt?: string;
  latestRuns: GithubWorkflowRun[];
}

/** Response of `GET /api/code-quality/report?entityRef=...`. */
export interface CodeQualityReport {
  entityRef: string;
  generatedAt: string;
  sonarqube: SectionResult<SonarQubeSummary>;
  github: SectionResult<GithubSummary>;
}
