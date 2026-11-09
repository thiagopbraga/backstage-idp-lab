import {
  createApiRef,
  DiscoveryApi,
  FetchApi,
} from '@backstage/frontend-plugin-api';
import { ResponseError } from '@backstage/errors';
import { CodeQualityReport } from '@internal/backstage-plugin-code-quality-common';

/** Frontend contract of the code-quality backend. */
export interface CodeQualityApi {
  getReport(entityRef: string): Promise<CodeQualityReport>;
}

export const codeQualityApiRef = createApiRef<CodeQualityApi>().with({
  id: 'plugin.code-quality.service',
  pluginId: 'code-quality',
});

/**
 * Default implementation: resolves the backend URL through the DiscoveryApi
 * and calls it with the FetchApi, which injects the user's Backstage token.
 */
export class CodeQualityClient implements CodeQualityApi {
  constructor(
    private readonly options: {
      discoveryApi: DiscoveryApi;
      fetchApi: FetchApi;
    },
  ) {}

  async getReport(entityRef: string): Promise<CodeQualityReport> {
    const baseUrl = await this.options.discoveryApi.getBaseUrl('code-quality');
    const response = await this.options.fetchApi.fetch(
      `${baseUrl}/report?entityRef=${encodeURIComponent(entityRef)}`,
    );
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
    return (await response.json()) as CodeQualityReport;
  }
}
