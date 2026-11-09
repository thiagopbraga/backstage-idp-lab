import { ConfigReader } from '@backstage/config';
import { ScmIntegrations } from '@backstage/integration';
import { createMockActionContext } from '@backstage/plugin-scaffolder-node-test-utils';
import { createDispatchWorkflowAction } from './dispatchWorkflow';

const integrations = (token?: string) =>
  ScmIntegrations.fromConfig(
    new ConfigReader({
      integrations: {
        github: [{ host: 'github.com', ...(token && { token }) }],
      },
    }),
  );

const input = { repo: 'acme/claims-intake-api', workflowId: 'ci.yml' };

describe('fastflow:github:dispatch-workflow', () => {
  it('skips gracefully when no token is configured', async () => {
    const fetchFn = jest.fn();
    const action = createDispatchWorkflowAction({
      integrations: integrations(),
      fetchFn,
    });
    const ctx = createMockActionContext({ input });
    await expect(action.handler(ctx)).resolves.toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(ctx.output).toHaveBeenCalledWith('dispatched', false);
    expect(ctx.output).toHaveBeenCalledWith(
      'reason',
      'no GitHub token configured for github.com (integrations.github)',
    );
  });

  it('skips in dry-run even with a token', async () => {
    const fetchFn = jest.fn();
    const action = createDispatchWorkflowAction({
      integrations: integrations('t'),
      fetchFn,
    });
    const ctx = { ...createMockActionContext({ input }), isDryRun: true };
    await action.handler(ctx);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(ctx.output).toHaveBeenCalledWith('dispatched', false);
  });

  it('calls the workflow_dispatch API with the token', async () => {
    const fetchFn = jest.fn(async () => new Response(null, { status: 204 }));
    const action = createDispatchWorkflowAction({
      integrations: integrations('gh-token'),
      fetchFn,
    });
    const ctx = createMockActionContext({
      input: { ...input, ref: 'develop', inputs: { environment: 'dev' } },
    });
    await action.handler(ctx);

    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      'https://api.github.com/repos/acme/claims-intake-api/actions/workflows/ci.yml/dispatches',
    );
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer gh-token',
    );
    expect(JSON.parse(init.body as string)).toEqual({
      ref: 'develop',
      inputs: { environment: 'dev' },
    });
    expect(ctx.output).toHaveBeenCalledWith('dispatched', true);
  });

  it('does not fail the template on API errors unless failOnError', async () => {
    const fetchFn = jest.fn(
      async () => new Response('', { status: 404, statusText: 'Not Found' }),
    );
    const action = createDispatchWorkflowAction({
      integrations: integrations('t'),
      fetchFn,
    });

    const lenient = createMockActionContext({ input });
    await expect(action.handler(lenient)).resolves.toBeUndefined();
    expect(lenient.output).toHaveBeenCalledWith('dispatched', false);

    const strict = createMockActionContext({
      input: { ...input, failOnError: true },
    });
    await expect(action.handler(strict)).rejects.toThrow(
      'workflow_dispatch failed: GitHub responded 404 Not Found',
    );
  });

  it('rejects malformed repo slugs', async () => {
    const action = createDispatchWorkflowAction({
      integrations: integrations('t'),
      fetchFn: jest.fn(),
    });
    await expect(
      action.handler(
        createMockActionContext({ input: { ...input, repo: '../../orgs' } }),
      ),
    ).rejects.toThrow('repo must be "owner/repo"');
  });
});
