import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatSidebarRelativeDate } from '../../../src/renderer/components/Sidebar/sidebarDateFormatting';

describe('formatSidebarRelativeDate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-23T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats same-day dates as time', () => {
    const result = formatSidebarRelativeDate({
      dateString: '2026-02-23T10:30:00.000Z',
      language: 'en',
      t: () => 'Yesterday',
    });

    expect(result).toMatch(/\d/);
    expect(result).not.toBe('Yesterday');
  });

  it('formats one-day-old dates as localized yesterday label', () => {
    const result = formatSidebarRelativeDate({
      dateString: '2026-02-22T10:30:00.000Z',
      language: 'en',
      t: () => 'Yesterday',
    });

    expect(result).toBe('Yesterday');
  });

  it('formats older dates within a week using weekday', () => {
    const result = formatSidebarRelativeDate({
      dateString: '2026-02-20T10:30:00.000Z',
      language: 'en',
      t: () => 'Yesterday',
    });

    expect(result).toMatch(/^[A-Za-z]{3}$/);
  });

  it('formats older dates with month/day', () => {
    const result = formatSidebarRelativeDate({
      dateString: '2026-02-10T10:30:00.000Z',
      language: 'en',
      t: () => 'Yesterday',
    });

    expect(result).toMatch(/[A-Za-z]{3}/);
  });
});
