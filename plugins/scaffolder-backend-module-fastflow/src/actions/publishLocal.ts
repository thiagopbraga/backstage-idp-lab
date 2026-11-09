import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveSafeChildPath } from '@backstage/backend-plugin-api';
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';

export const PUBLISH_LOCAL_ACTION_ID = 'fastflow:publish:local';

const SAFE_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * `fastflow:publish:local` - offline "publisher" for demos and template
 * development: copies the generated workspace to
 * `<fastflow.scaffolder.localOutputDir>/<name>-<taskId>` instead of creating a
 * repository. In production the template uses publish:github + catalog:register.
 */
export function createPublishLocalAction(options: { outputDir: string }) {
  return createTemplateAction({
    id: PUBLISH_LOCAL_ACTION_ID,
    description:
      'Copies the generated workspace to a local directory (offline alternative to publish:github)',
    schema: {
      input: {
        name: z =>
          z.string().describe('Directory name prefix (component name)'),
        sourcePath: z =>
          z
            .string()
            .optional()
            .describe('Sub-path of the workspace to publish (default: root)'),
      },
      output: {
        path: z => z.string().describe('Absolute path of the published files'),
        catalogInfoPath: z => z.string(),
      },
    },
    async handler(ctx) {
      const { name } = ctx.input;
      if (!SAFE_NAME.test(name)) {
        throw new Error(`name "${name}" is not a safe directory name`);
      }
      const source = ctx.input.sourcePath
        ? resolveSafeChildPath(ctx.workspacePath, ctx.input.sourcePath)
        : ctx.workspacePath;
      const target = resolveSafeChildPath(
        options.outputDir,
        `${name}-${ctx.task.id.slice(0, 8)}`,
      );

      if (ctx.isDryRun) {
        ctx.logger.info(`[dry run] would publish ${source} to ${target}`);
      } else {
        await fs.mkdir(options.outputDir, { recursive: true });
        await fs.cp(source, target, { recursive: true, errorOnExist: true });
        ctx.logger.info(`Published generated files to ${target}`);
      }
      ctx.output('path', target);
      ctx.output('catalogInfoPath', path.join(target, 'catalog-info.yaml'));
    },
  });
}
