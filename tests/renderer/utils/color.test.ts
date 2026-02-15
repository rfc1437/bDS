import { describe, it, expect } from 'vitest';
import { getContrastColor } from '../../../src/renderer/utils/color';

describe('getContrastColor', () => {
  it('should return black text for light 6-char colors', () => {
    expect(getContrastColor('#ffffff')).toBe('#000000');
    expect(getContrastColor('fef3c7')).toBe('#000000');
  });

  it('should return white text for dark 6-char colors', () => {
    expect(getContrastColor('#000000')).toBe('#ffffff');
    expect(getContrastColor('1f2937')).toBe('#ffffff');
  });

  it('should support 3-char hex colors', () => {
    expect(getContrastColor('#abc')).toBe('#000000');
    expect(getContrastColor('333')).toBe('#ffffff');
  });
});