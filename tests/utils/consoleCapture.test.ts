import { describe, expect, it } from 'vitest';

import { withCapturedConsole } from './consoleCapture';

describe('withCapturedConsole', () => {
  it('captures expected console output without leaking it to the test run', async () => {
    await withCapturedConsole('error', async (captured) => {
      const error = new Error('expected failure');

      console.error('[Test]', error);

      expect(captured.spy).toHaveBeenCalledWith('[Test]', error);
      expect(captured.text()).toContain('[Test]');
      expect(captured.text()).toContain('expected failure');
    });
  });
});