import { createBackend } from '@backstage/backend-defaults';
import { mockServices } from '@backstage/backend-test-utils';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';

// Standalone dev backend for the plugin (mock auth + in-memory catalog).
// Run `yarn start` in this package, then:
//
//   curl 'http://localhost:7007/api/code-quality/report?entityRef=component:default/sample'
//   curl 'http://localhost:7007/api/code-quality/report?entityRef=component:default/sample' \
//     -H 'Authorization: Bearer mock-none-token'   # -> 401

const backend = createBackend();

// TEMPLATE NOTE:
// Mocking the auth and httpAuth service allows you to call your plugin API without
// having to authenticate.
//
// If you want to use real auth, you can install the following instead:
//   backend.add(import('@backstage/plugin-auth-backend'));
//   backend.add(import('@backstage/plugin-auth-backend-module-guest-provider'));
backend.add(mockServices.auth.factory());
backend.add(mockServices.httpAuth.factory());

// TEMPLATE NOTE:
// Rather than using a real catalog you can use a mock with a fixed set of entities.
backend.add(
  catalogServiceMock.factory({
    entities: [
      {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Component',
        metadata: {
          name: 'sample',
          title: 'Sample Component',
          annotations: {
            'sonarqube.org/project-key': 'sample',
            'github.com/project-slug': 'acme/sample',
          },
        },
        spec: {
          type: 'service',
        },
      },
    ],
  }),
);

backend.add(import('../src'));

backend.start();
