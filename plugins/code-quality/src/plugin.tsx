import {
  createFrontendPlugin,
  PageBlueprint,
} from '@backstage/frontend-plugin-api';

import { rootRouteRef } from './routes';

export const page = PageBlueprint.make({
  params: {
    path: '/code-quality',
    routeRef: rootRouteRef,
    loader: () => import('./components/TodoPage').then(m => <m.TodoPage />),
  },
});

export const codeQualityPlugin = createFrontendPlugin({
  pluginId: 'code-quality',
  extensions: [page],
  routes: {
    root: rootRouteRef,
  },
});
