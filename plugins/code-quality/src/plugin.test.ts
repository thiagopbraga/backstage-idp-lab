import { codeQualityPlugin } from './plugin';

describe('code-quality', () => {
  it('should export plugin', () => {
    expect(codeQualityPlugin).toBeDefined();
  });
});
