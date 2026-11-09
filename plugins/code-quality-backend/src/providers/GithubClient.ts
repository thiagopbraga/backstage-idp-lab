import {
  GithubSummary,
  GithubWorkflowRun,
} from '@internal/backstage-plugin-code-quality-common';
import { assertGithubSlug, getJson } from './http';
import { FetchFn, GithubProvider } from './types';

type RepoResponse = {
  html_url: string;
  default_branch: string;
  visibility?: string;
  private: boolean;
  open_issues_count: number;
  pushed_at?: string;
};

type RunsResponse = {
  workflow_runs: Array<{
    id: number;
    name?: string | null;
    status: string | null;
    conclusion: string | null;
    head_branch: string | null;
    event: string;
    created_at: string;
    html_url: string;
  }>;
};

/** Minimal GitHub REST client (repo metadata + latest Actions runs). */
export class GithubClient implements GithubProvider {
  readonly source = 'live' as const;
  private readonly apiBaseUrl: string;

  constructor(
    private readonly options: {
      apiBaseUrl?: string;
      token?: string;
      runsLimit?: number;
      fetchFn?: FetchFn;
    },
  ) {
    this.apiBaseUrl = (options.apiBaseUrl ?? 'https://api.github.com').replace(
      /\/+$/,
      '',
    );
  }

  async getSummary(slug: string): Promise<GithubSummary> {
    assertGithubSlug(slug);
    const limit = this.options.runsLimit ?? 5;

    const [repo, runs] = await Promise.all([
      this.get<RepoResponse>(`/repos/${slug}`),
      this.get<RunsResponse>(`/repos/${slug}/actions/runs?per_page=${limit}`),
    ]);

    return {
      slug,
      url: repo.html_url,
      defaultBranch: repo.default_branch,
      visibility: repo.visibility ?? (repo.private ? 'private' : 'public'),
      openIssues: repo.open_issues_count,
      pushedAt: repo.pushed_at,
      latestRuns: runs.workflow_runs.slice(0, limit).map(
        (run): GithubWorkflowRun => ({
          id: run.id,
          name: run.name ?? 'workflow',
          status: run.status ?? 'unknown',
          conclusion: run.conclusion,
          branch: run.head_branch ?? '',
          event: run.event,
          createdAt: run.created_at,
          url: run.html_url,
        }),
      ),
    };
  }

  private get<T>(path: string): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (this.options.token) {
      headers.Authorization = `Bearer ${this.options.token}`;
    }
    return getJson<T>(
      this.options.fetchFn ?? fetch,
      `${this.apiBaseUrl}${path}`,
      {
        headers,
        upstream: 'GitHub',
      },
    );
  }
}
