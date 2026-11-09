import {
  QualityGateStatus,
  SonarQubeMetrics,
  SonarQubeSummary,
} from '@internal/backstage-plugin-code-quality-common';
import { getJson } from './http';
import { FetchFn, SonarQubeProvider } from './types';

/** Metric keys requested from `api/measures/component`. */
export const SONAR_METRIC_KEYS = [
  'coverage',
  'bugs',
  'vulnerabilities',
  'code_smells',
  'security_hotspots',
  'duplicated_lines_density',
] as const;

const METRIC_FIELD: Record<
  (typeof SONAR_METRIC_KEYS)[number],
  keyof SonarQubeMetrics
> = {
  coverage: 'coverage',
  bugs: 'bugs',
  vulnerabilities: 'vulnerabilities',
  code_smells: 'codeSmells',
  security_hotspots: 'securityHotspots',
  duplicated_lines_density: 'duplicatedLinesDensity',
};

type ProjectStatusResponse = {
  projectStatus: { status: QualityGateStatus };
};

type MeasuresResponse = {
  component: { measures: Array<{ metric: string; value?: string }> };
};

/**
 * Thin client for the SonarQube / SonarCloud Web API.
 * Docs: https://next.sonarqube.com/sonarqube/web_api
 */
export class SonarQubeClient implements SonarQubeProvider {
  readonly source = 'live' as const;
  private readonly baseUrl: string;

  constructor(
    private readonly options: {
      baseUrl: string;
      token: string;
      fetchFn?: FetchFn;
    },
  ) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
  }

  async getSummary(projectKey: string): Promise<SonarQubeSummary> {
    const key = encodeURIComponent(projectKey);
    const metricKeys = SONAR_METRIC_KEYS.join(',');

    const [gate, measures] = await Promise.all([
      this.get<ProjectStatusResponse>(
        `/api/qualitygates/project_status?projectKey=${key}`,
      ),
      this.get<MeasuresResponse>(
        `/api/measures/component?component=${key}&metricKeys=${metricKeys}`,
      ),
    ]);

    const metrics: SonarQubeMetrics = {};
    for (const measure of measures.component.measures) {
      const field = METRIC_FIELD[measure.metric as keyof typeof METRIC_FIELD];
      const value = Number(measure.value);
      if (field && measure.value !== undefined && Number.isFinite(value)) {
        metrics[field] = value;
      }
    }

    return {
      projectKey,
      dashboardUrl: `${this.baseUrl}/dashboard?id=${key}`,
      qualityGate: gate.projectStatus.status ?? 'NONE',
      metrics,
    };
  }

  private get<T>(path: string): Promise<T> {
    // User tokens are sent as the basic-auth username with an empty password,
    // which works for both SonarQube Server and SonarCloud.
    const basic = Buffer.from(`${this.options.token}:`).toString('base64');
    return getJson<T>(this.options.fetchFn ?? fetch, `${this.baseUrl}${path}`, {
      headers: { Authorization: `Basic ${basic}` },
      upstream: 'SonarQube',
    });
  }
}
