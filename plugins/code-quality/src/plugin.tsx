import {
  ApiBlueprint,
  createFrontendPlugin,
  discoveryApiRef,
  fetchApiRef,
} from '@backstage/frontend-plugin-api';
import { EntityCardBlueprint } from '@backstage/plugin-catalog-react/alpha';
import { isCodeQualityAvailable } from '@internal/backstage-plugin-code-quality-common';
import { codeQualityApiRef, CodeQualityClient } from './api';

/** Registers the CodeQualityApi implementation (ApiRef -> factory). */
export const codeQualityApi = ApiBlueprint.make({
  params: defineParams =>
    defineParams({
      api: codeQualityApiRef,
      deps: { discoveryApi: discoveryApiRef, fetchApi: fetchApiRef },
      factory: ({ discoveryApi, fetchApi }) =>
        new CodeQualityClient({ discoveryApi, fetchApi }),
    }),
});

/**
 * Entity card shown on the overview tab of entities that declare
 * sonarqube.org/project-key and/or github.com/project-slug.
 * Can be disabled or reconfigured in app-config under
 * app.extensions: - entity-card:code-quality/overview
 */
export const codeQualityEntityCard = EntityCardBlueprint.make({
  name: 'overview',
  params: {
    filter: isCodeQualityAvailable,
    loader: () =>
      import('./components/CodeQualityCard').then(m => <m.CodeQualityCard />),
  },
});

export const codeQualityPlugin = createFrontendPlugin({
  pluginId: 'code-quality',
  extensions: [codeQualityApi, codeQualityEntityCard],
});
