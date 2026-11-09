import { ScmIntegrations } from '@backstage/integration';
import { isError } from '@backstage/errors';
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';

export const DISPATCH_WORKFLOW_ACTION_ID = 'fastflow:github:dispatch-workflow';

const SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * `fastflow:github:dispatch-workflow` - triggers a GitHub Actions
 * `workflow_dispatch` (e.g. the first pipeline of a freshly created service,
 * or a platform pipeline that provisions infra).
 *
 * Unlike the built-in `github:actions:dispatch`, it DEGRADES GRACEFULLY: with
 * no token for the host, in dry-run, or (by default) on API errors it logs a
 * warning and outputs `dispatched: false` instead of failing the template, so
 * golden paths keep working in offline demos and during GitHub incidents.
 */
export function createDispatchWorkflowAction(options: {
  integrations: ScmIntegrations;
  fetchFn?: typeof fetch;
}) {
  const fetchFn = options.fetchFn ?? fetch;

  return createTemplateAction({
    id: DISPATCH_WORKFLOW_ACTION_ID,
    description:
      'Triggers a GitHub Actions workflow_dispatch; skips (does not fail) when no token is configured',
    schema: {
      input: {
        repo: z => z.string().describe('owner/repo of the workflow'),
        workflowId: z =>
          z.string().describe('Workflow file name (ci.yml) or numeric id'),
        ref: z =>
          z.string().optional().describe('Git ref to run on (default: main)'),
        inputs: z =>
          z.record(z.string()).optional().describe('workflow_dispatch inputs'),
        host: z =>
          z.string().optional().describe('GitHub host (default github.com)'),
        failOnError: z =>
          z
            .boolean()
            .optional()
            .describe('Fail the task on API errors (default false)'),
      },
      output: {
        dispatched: z => z.boolean(),
        reason: z => z.string().optional(),
      },
    },
    async handler(ctx) {
      const { repo, workflowId, inputs } = ctx.input;
      const ref = ctx.input.ref ?? 'main';
      const host = ctx.input.host ?? 'github.com';

      const skip = (reason: string) => {
        ctx.logger.warn(
          `Skipping workflow_dispatch of ${repo}/${workflowId}: ${reason}`,
        );
        ctx.output('dispatched', false);
        ctx.output('reason', reason);
      };

      if (!SLUG.test(repo) || repo.includes('..')) {
        throw new Error(`repo must be "owner/repo", got "${repo}"`);
      }
      if (ctx.isDryRun) {
        skip('dry run');
        return;
      }
      const integration = options.integrations.github.byHost(host);
      const token = integration?.config.token;
      if (!integration || !token) {
        skip(`no GitHub token configured for ${host} (integrations.github)`);
        return;
      }

      const apiBaseUrl =
        integration.config.apiBaseUrl ?? 'https://api.github.com';
      const url = `${apiBaseUrl}/repos/${repo}/actions/workflows/${encodeURIComponent(
        workflowId,
      )}/dispatches`;
      try {
        const response = await fetchFn(url, {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ref, inputs: inputs ?? {} }),
          signal: AbortSignal.timeout(15_000),
        });
        if (response.status !== 204) {
          throw new Error(
            `GitHub responded ${response.status} ${response.statusText}`.trim(),
          );
        }
      } catch (error) {
        const message = isError(error) ? error.message : String(error);
        if (ctx.input.failOnError) {
          throw new Error(`workflow_dispatch failed: ${message}`);
        }
        skip(`workflow_dispatch failed: ${message}`);
        return;
      }

      ctx.logger.info(`Dispatched ${workflowId} on ${repo}@${ref}`);
      ctx.output('dispatched', true);
    },
  });
}
