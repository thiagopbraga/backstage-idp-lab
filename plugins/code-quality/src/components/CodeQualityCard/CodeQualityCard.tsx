import { ReactNode } from 'react';
import {
  InfoCard,
  Link,
  Progress,
  ResponseErrorPanel,
  StatusAborted,
  StatusError,
  StatusOK,
  StatusPending,
  StatusRunning,
  StatusWarning,
} from '@backstage/core-components';
import { useApi } from '@backstage/frontend-plugin-api';
import { stringifyEntityRef } from '@backstage/catalog-model';
import { useEntity } from '@backstage/plugin-catalog-react';
import {
  GithubSummary,
  GithubWorkflowRun,
  QualityGateStatus,
  SectionResult,
  SonarQubeSummary,
} from '@internal/backstage-plugin-code-quality-common';
import Box from '@material-ui/core/Box';
import Chip from '@material-ui/core/Chip';
import Divider from '@material-ui/core/Divider';
import Grid from '@material-ui/core/Grid';
import Typography from '@material-ui/core/Typography';
import useAsyncRetry from 'react-use/esm/useAsyncRetry';
import { codeQualityApiRef } from '../../api';

const GATE_LABEL: Record<QualityGateStatus, ReactNode> = {
  OK: <StatusOK>Quality gate passed</StatusOK>,
  WARN: <StatusWarning>Quality gate warning</StatusWarning>,
  ERROR: <StatusError>Quality gate failed</StatusError>,
  NONE: <StatusPending>No quality gate</StatusPending>,
};

function SourceChip({ source }: { source: 'live' | 'mock' }) {
  return source === 'mock' ? (
    <Chip size="small" label="mock data" variant="outlined" />
  ) : (
    <Chip size="small" label="live" color="primary" variant="outlined" />
  );
}

function Metric({ label, value }: { label: string; value?: number | string }) {
  return (
    <Grid item xs={4}>
      <Typography variant="h5" component="p">
        {value ?? '–'}
      </Typography>
      <Typography variant="caption" color="textSecondary">
        {label}
      </Typography>
    </Grid>
  );
}

function SectionHeader(props: { title: string; right?: ReactNode }) {
  return (
    <Box
      display="flex"
      alignItems="center"
      justifyContent="space-between"
      mb={1}
    >
      <Typography variant="subtitle1">
        <strong>{props.title}</strong>
      </Typography>
      {props.right}
    </Box>
  );
}

function NotOk({
  result,
  annotation,
}: {
  result: Exclude<SectionResult<unknown>, { status: 'ok' }>;
  annotation: string;
}) {
  return result.status === 'not-configured' ? (
    <Typography variant="body2" color="textSecondary">
      Add the <code>{annotation}</code> annotation to enable this section.
    </Typography>
  ) : (
    <Typography variant="body2" color="error">
      Unavailable: {result.message}
    </Typography>
  );
}

export function SonarQubeSection({
  result,
}: {
  result: SectionResult<SonarQubeSummary>;
}) {
  if (result.status !== 'ok') {
    return (
      <>
        <SectionHeader title="SonarQube" />
        <NotOk result={result} annotation="sonarqube.org/project-key" />
      </>
    );
  }
  const { data } = result;
  const { metrics } = data;
  return (
    <>
      <SectionHeader
        title="SonarQube"
        right={<SourceChip source={result.source} />}
      />
      <Box mb={1}>
        {GATE_LABEL[data.qualityGate]}{' '}
        <Link to={data.dashboardUrl}>open dashboard</Link>
      </Box>
      <Grid container spacing={1}>
        <Metric
          label="Coverage"
          value={
            metrics.coverage !== undefined ? `${metrics.coverage}%` : undefined
          }
        />
        <Metric label="Bugs" value={metrics.bugs} />
        <Metric label="Vulnerabilities" value={metrics.vulnerabilities} />
        <Metric label="Code smells" value={metrics.codeSmells} />
        <Metric label="Security hotspots" value={metrics.securityHotspots} />
        <Metric
          label="Duplication"
          value={
            metrics.duplicatedLinesDensity !== undefined
              ? `${metrics.duplicatedLinesDensity}%`
              : undefined
          }
        />
      </Grid>
    </>
  );
}

function RunStatus({ run }: { run: GithubWorkflowRun }) {
  if (run.status !== 'completed') {
    return <StatusRunning>{run.status.replace('_', ' ')}</StatusRunning>;
  }
  switch (run.conclusion) {
    case 'success':
      return <StatusOK>success</StatusOK>;
    case 'failure':
    case 'timed_out':
      return <StatusError>{run.conclusion.replace('_', ' ')}</StatusError>;
    case 'cancelled':
    case 'skipped':
      return <StatusAborted>{run.conclusion}</StatusAborted>;
    default:
      return <StatusWarning>{run.conclusion ?? 'unknown'}</StatusWarning>;
  }
}

export function GithubSection({
  result,
}: {
  result: SectionResult<GithubSummary>;
}) {
  if (result.status !== 'ok') {
    return (
      <>
        <SectionHeader title="GitHub Actions" />
        <NotOk result={result} annotation="github.com/project-slug" />
      </>
    );
  }
  const { data } = result;
  return (
    <>
      <SectionHeader
        title="GitHub Actions"
        right={<SourceChip source={result.source} />}
      />
      <Typography variant="body2" color="textSecondary" gutterBottom>
        <Link to={data.url}>{data.slug}</Link> · default branch{' '}
        <code>{data.defaultBranch}</code> · {data.openIssues} open issues
      </Typography>
      {data.latestRuns.length === 0 ? (
        <Typography variant="body2">No workflow runs yet.</Typography>
      ) : (
        <Box component="ul" p={0} m={0} style={{ listStyle: 'none' }}>
          {data.latestRuns.map(run => (
            <Box component="li" key={run.id} py={0.5}>
              <RunStatus run={run} /> <Link to={run.url}>{run.name}</Link>{' '}
              <Typography variant="caption" color="textSecondary">
                {run.event} on {run.branch || '—'} ·{' '}
                {new Date(run.createdAt).toLocaleString()}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </>
  );
}

/** Entity page card: SonarQube quality + latest GitHub Actions runs. */
export function CodeQualityCard() {
  const { entity } = useEntity();
  const api = useApi(codeQualityApiRef);
  const entityRef = stringifyEntityRef(entity);

  const { value, loading, error, retry } = useAsyncRetry(
    () => api.getReport(entityRef),
    [api, entityRef],
  );

  let content: ReactNode;
  if (loading) {
    content = <Progress />;
  } else if (error) {
    content = <ResponseErrorPanel error={error} />;
  } else if (value) {
    content = (
      <>
        <SonarQubeSection result={value.sonarqube} />
        <Box my={2}>
          <Divider />
        </Box>
        <GithubSection result={value.github} />
      </>
    );
  }

  return (
    <InfoCard
      title="Code quality & CI"
      subheader="SonarQube quality gate and latest GitHub Actions runs"
      action={
        <Box pt={1} pr={1}>
          <Link
            to="#"
            onClick={e => {
              e.preventDefault();
              retry();
            }}
          >
            refresh
          </Link>
        </Box>
      }
    >
      {content}
    </InfoCard>
  );
}
