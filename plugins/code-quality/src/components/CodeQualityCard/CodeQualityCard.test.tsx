import { screen } from '@testing-library/react';
import {
  renderInTestApp,
  TestApiProvider,
} from '@backstage/frontend-test-utils';
import { EntityProvider } from '@backstage/plugin-catalog-react';
import { Entity } from '@backstage/catalog-model';
import { CodeQualityReport } from '@internal/backstage-plugin-code-quality-common';
import { codeQualityApiRef } from '../../api';
import { CodeQualityCard } from './CodeQualityCard';

const entity: Entity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: {
    name: 'claims-api',
    namespace: 'default',
    annotations: {
      'sonarqube.org/project-key': 'claims-api',
      'github.com/project-slug': 'acme/claims-api',
    },
  },
  spec: { type: 'service', owner: 'group:default/claims-squad' },
};

const report: CodeQualityReport = {
  entityRef: 'component:default/claims-api',
  generatedAt: '2026-11-09T12:00:00.000Z',
  sonarqube: {
    status: 'ok',
    source: 'mock',
    data: {
      projectKey: 'claims-api',
      dashboardUrl: 'https://sonar.example.com/dashboard?id=claims-api',
      qualityGate: 'ERROR',
      metrics: { coverage: 58.3, bugs: 4, vulnerabilities: 2, codeSmells: 17 },
    },
  },
  github: {
    status: 'ok',
    source: 'live',
    data: {
      slug: 'acme/claims-api',
      url: 'https://github.com/acme/claims-api',
      defaultBranch: 'main',
      visibility: 'private',
      openIssues: 3,
      latestRuns: [
        {
          id: 1,
          name: 'Deploy to production',
          status: 'completed',
          conclusion: 'failure',
          branch: 'main',
          event: 'push',
          createdAt: '2026-11-09T10:00:00Z',
          url: 'https://github.com/acme/claims-api/actions/runs/1',
        },
      ],
    },
  },
};

async function renderCard(getReport: jest.Mock) {
  return renderInTestApp(
    <TestApiProvider apis={[[codeQualityApiRef, { getReport }]]}>
      <EntityProvider entity={entity}>
        <CodeQualityCard />
      </EntityProvider>
    </TestApiProvider>,
  );
}

describe('CodeQualityCard', () => {
  it('renders SonarQube metrics and GitHub runs for the current entity', async () => {
    const getReport = jest.fn().mockResolvedValue(report);
    await renderCard(getReport);

    expect(await screen.findByText('Quality gate failed')).toBeInTheDocument();
    expect(screen.getByText('58.3%')).toBeInTheDocument();
    expect(screen.getByText('Vulnerabilities')).toBeInTheDocument();
    expect(screen.getByText('mock data')).toBeInTheDocument();
    expect(screen.getByText('live')).toBeInTheDocument();
    expect(screen.getByText('Deploy to production')).toBeInTheDocument();
    expect(screen.getByText('failure')).toBeInTheDocument();
    expect(getReport).toHaveBeenCalledWith('component:default/claims-api');
  });

  it('explains missing annotations and isolated provider errors', async () => {
    const getReport = jest.fn().mockResolvedValue({
      ...report,
      sonarqube: { status: 'error', message: 'SonarQube responded 503' },
      github: { status: 'not-configured' },
    });
    await renderCard(getReport);

    expect(
      await screen.findByText('Unavailable: SonarQube responded 503'),
    ).toBeInTheDocument();
    expect(screen.getByText('github.com/project-slug')).toBeInTheDocument();
  });

  it('shows an error panel when the backend call fails', async () => {
    const getReport = jest.fn().mockRejectedValue(new Error('boom'));
    await renderCard(getReport);
    expect(await screen.findByText('Error: boom')).toBeInTheDocument();
  });
});
