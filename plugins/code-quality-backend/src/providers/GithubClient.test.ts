import { InputError } from '@backstage/errors';
import { GithubClient } from './GithubClient';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

const repo = {
  html_url: 'https://github.com/acme/claims-api',
  default_branch: 'main',
  visibility: 'private',
  private: true,
  open_issues_count: 4,
  pushed_at: '2026-11-01T10:00:00Z',
};

const runs = {
  workflow_runs: [
    {
      id: 1,
      name: 'CI',
      status: 'completed',
      conclusion: 'success',
      head_branch: 'main',
      event: 'push',
      created_at: '2026-11-01T10:00:00Z',
      html_url: 'https://github.com/acme/claims-api/actions/runs/1',
    },
    {
      id: 2,
      name: null,
      status: 'in_progress',
      conclusion: null,
      head_branch: null,
      event: 'workflow_dispatch',
      created_at: '2026-11-01T11:00:00Z',
      html_url: 'https://github.com/acme/claims-api/actions/runs/2',
    },
  ],
};

describe('GithubClient', () => {
  it('combines repository metadata and latest workflow runs', async () => {
    const fetchFn = jest.fn(async (input: string | URL | Request) =>
      String(input).includes('/actions/runs') ? json(runs) : json(repo),
    );
    const client = new GithubClient({
      token: 'gh-token',
      runsLimit: 3,
      fetchFn: fetchFn as typeof fetch,
    });

    const summary = await client.getSummary('acme/claims-api');

    expect(summary).toMatchObject({
      slug: 'acme/claims-api',
      url: 'https://github.com/acme/claims-api',
      defaultBranch: 'main',
      visibility: 'private',
      openIssues: 4,
    });
    expect(summary.latestRuns).toEqual([
      expect.objectContaining({ id: 1, name: 'CI', conclusion: 'success' }),
      expect.objectContaining({
        id: 2,
        name: 'workflow',
        status: 'in_progress',
        conclusion: null,
        branch: '',
      }),
    ]);

    const urls = fetchFn.mock.calls.map(c => String(c[0]));
    expect(urls).toEqual([
      'https://api.github.com/repos/acme/claims-api',
      'https://api.github.com/repos/acme/claims-api/actions/runs?per_page=3',
    ]);
    const headers = (
      fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    )[1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer gh-token');
    expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28');
  });

  it('omits the Authorization header without a token', async () => {
    const fetchFn = jest.fn(async (input: string | URL | Request) =>
      String(input).includes('/actions/runs') ? json(runs) : json(repo),
    );
    await new GithubClient({ fetchFn: fetchFn as typeof fetch }).getSummary(
      'acme/claims-api',
    );
    const headers = (
      fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    )[1].headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it.each(['acme', 'acme/claims/../../user', '../etc/passwd', 'a/b?x=1'])(
    'rejects unsafe slug %p before calling the API',
    async slug => {
      const fetchFn = jest.fn();
      const client = new GithubClient({ fetchFn: fetchFn as typeof fetch });
      await expect(client.getSummary(slug)).rejects.toBeInstanceOf(InputError);
      expect(fetchFn).not.toHaveBeenCalled();
    },
  );
});
