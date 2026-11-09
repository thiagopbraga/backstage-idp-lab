import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMockActionContext } from '@backstage/plugin-scaffolder-node-test-utils';
import { createPublishLocalAction } from './publishLocal';

describe('fastflow:publish:local', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'fastflow-test-'));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function workspaceWithFile() {
    const workspacePath = path.join(root, 'workspace');
    await fs.mkdir(workspacePath, { recursive: true });
    await fs.writeFile(
      path.join(workspacePath, 'catalog-info.yaml'),
      'kind: Component\n',
    );
    return workspacePath;
  }

  it('copies the workspace to <outputDir>/<name>-<taskId>', async () => {
    const workspacePath = await workspaceWithFile();
    const outputDir = path.join(root, 'out');
    const action = createPublishLocalAction({ outputDir });
    const ctx = createMockActionContext({
      input: { name: 'claims-intake-api' },
      workspacePath,
      task: { id: 'abcdef1234567890' },
    });

    await action.handler(ctx);

    const target = path.join(outputDir, 'claims-intake-api-abcdef12');
    expect(ctx.output).toHaveBeenCalledWith('path', target);
    await expect(
      fs.readFile(path.join(target, 'catalog-info.yaml'), 'utf8'),
    ).resolves.toBe('kind: Component\n');
  });

  it('does not write anything in dry-run', async () => {
    const workspacePath = await workspaceWithFile();
    const outputDir = path.join(root, 'out');
    const action = createPublishLocalAction({ outputDir });
    await action.handler({
      ...createMockActionContext({
        input: { name: 'claims-intake-api' },
        workspacePath,
      }),
      isDryRun: true,
    });
    await expect(fs.stat(outputDir)).rejects.toThrow();
  });

  it('refuses unsafe names and paths', async () => {
    const workspacePath = await workspaceWithFile();
    const action = createPublishLocalAction({
      outputDir: path.join(root, 'out'),
    });
    await expect(
      action.handler(
        createMockActionContext({ input: { name: '../etc' }, workspacePath }),
      ),
    ).rejects.toThrow('is not a safe directory name');
    await expect(
      action.handler(
        createMockActionContext({
          input: { name: 'ok-api', sourcePath: '../../' },
          workspacePath,
        }),
      ),
    ).rejects.toThrow();
  });
});
