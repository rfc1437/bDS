import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  A2UIMindmap,
  buildTree,
  computeLayout,
  wrapText,
  nodeSize,
  MAX_NODE_WIDTH,
  LINE_HEIGHT,
} from '../../../src/renderer/a2ui/components/A2UIMindmap';
import type { A2UIResolvedComponent, A2UIClientAction } from '../../../src/main/a2ui/types';

function makeMindmapComponent(
  overrides: Partial<A2UIResolvedComponent> = {},
  nodes?: unknown,
): A2UIResolvedComponent {
  return {
    id: 'mindmap-1',
    type: 'mindmap',
    properties: {
      title: 'Test Mindmap',
      ...(overrides.properties ?? {}),
    },
    children: [],
    boundValue: nodes ?? [
      { id: 'root', label: 'Central Topic', children: ['a', 'b'] },
      { id: 'a', label: 'Branch A', children: ['a1'] },
      { id: 'b', label: 'Branch B' },
      { id: 'a1', label: 'Leaf' },
    ],
    ...overrides,
  };
}

const noopAction = vi.fn<(action: A2UIClientAction) => void>();

describe('A2UIMindmap', () => {
  describe('wrapText', () => {
    it('returns single line for short text', () => {
      const lines = wrapText('Hello', 200);
      expect(lines).toEqual(['Hello']);
    });

    it('wraps long text into multiple lines', () => {
      const long = 'This is a fairly long label that should wrap into multiple lines';
      const innerMax = MAX_NODE_WIDTH - 28; // NODE_PADDING_X * 2
      const lines = wrapText(long, innerMax);
      expect(lines.length).toBeGreaterThan(1);
      expect(lines.join(' ')).toBe(long);
    });

    it('handles single word that exceeds max width', () => {
      const lines = wrapText('Superlongwordwithoutspaces', 50);
      // Single word stays as one line
      expect(lines).toEqual(['Superlongwordwithoutspaces']);
    });

    it('preserves all words across lines', () => {
      const text = 'one two three four five six';
      const lines = wrapText(text, 80);
      expect(lines.join(' ')).toBe(text);
    });
  });

  describe('nodeSize', () => {
    it('returns single-line size for short label', () => {
      const result = nodeSize('Hi');
      expect(result.lines).toEqual(['Hi']);
      expect(result.height).toBe(LINE_HEIGHT + 16); // + padding*2
    });

    it('wraps long label into multiple lines', () => {
      const result = nodeSize('A very long label that definitely exceeds the max width');
      expect(result.lines.length).toBeGreaterThan(1);
      expect(result.width).toBeLessThanOrEqual(MAX_NODE_WIDTH);
      expect(result.height).toBeGreaterThan(LINE_HEIGHT + 16);
    });
  });

  describe('buildTree', () => {
    it('builds nested tree from flat node array', () => {
      const tree = buildTree([
        { id: 'root', label: 'Root', children: ['a', 'b'] },
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B', children: ['b1'] },
        { id: 'b1', label: 'B1' },
      ]);

      expect(tree).not.toBeNull();
      expect(tree!.id).toBe('root');
      expect(tree!.label).toBe('Root');
      expect(tree!.children).toHaveLength(2);
      expect(tree!.children[0].id).toBe('a');
      expect(tree!.children[0].children).toHaveLength(0);
      expect(tree!.children[1].id).toBe('b');
      expect(tree!.children[1].children).toHaveLength(1);
      expect(tree!.children[1].children[0].id).toBe('b1');
    });

    it('returns null for empty input', () => {
      expect(buildTree([])).toBeNull();
    });

    it('handles single root node', () => {
      const tree = buildTree([{ id: 'root', label: 'Solo' }]);
      expect(tree).not.toBeNull();
      expect(tree!.id).toBe('root');
      expect(tree!.children).toHaveLength(0);
    });

    it('skips children with invalid IDs', () => {
      const tree = buildTree([
        { id: 'root', label: 'Root', children: ['a', 'missing'] },
        { id: 'a', label: 'A' },
      ]);

      expect(tree!.children).toHaveLength(1);
      expect(tree!.children[0].id).toBe('a');
    });
  });

  describe('computeLayout', () => {
    it('computes layout for a simple tree', () => {
      const tree = buildTree([
        { id: 'root', label: 'Root', children: ['a', 'b'] },
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ])!;

      const layout = computeLayout(tree);

      expect(layout.nodes).toHaveLength(3);
      expect(layout.links).toHaveLength(2);
      expect(layout.svgWidth).toBeGreaterThan(0);
      expect(layout.svgHeight).toBeGreaterThan(0);
    });

    it('places children to the right of root (LR layout)', () => {
      const tree = buildTree([
        { id: 'root', label: 'Root', children: ['a', 'b'] },
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ])!;

      const layout = computeLayout(tree);
      const root = layout.nodes.find((n) => n.id === 'root')!;
      const nodeA = layout.nodes.find((n) => n.id === 'a')!;
      const nodeB = layout.nodes.find((n) => n.id === 'b')!;

      // LR layout: children should be to the right of root
      expect(nodeA.x).toBeGreaterThan(root.x);
      expect(nodeB.x).toBeGreaterThan(root.x);
    });

    it('assigns correct depth values', () => {
      const tree = buildTree([
        { id: 'root', label: 'R', children: ['a'] },
        { id: 'a', label: 'A', children: ['a1'] },
        { id: 'a1', label: 'A1' },
      ])!;

      const layout = computeLayout(tree);
      expect(layout.nodes.find((n) => n.id === 'root')!.depth).toBe(0);
      expect(layout.nodes.find((n) => n.id === 'a')!.depth).toBe(1);
      expect(layout.nodes.find((n) => n.id === 'a1')!.depth).toBe(2);
    });

    it('handles single node', () => {
      const tree = buildTree([{ id: 'root', label: 'Solo' }])!;
      const layout = computeLayout(tree);

      expect(layout.nodes).toHaveLength(1);
      expect(layout.links).toHaveLength(0);
      expect(layout.svgWidth).toBeGreaterThan(0);
      expect(layout.svgHeight).toBeGreaterThan(0);
    });

    it('provides wrapped lines for each node', () => {
      const tree = buildTree([
        { id: 'root', label: 'A long root label for wrapping test purposes here', children: ['a'] },
        { id: 'a', label: 'Short' },
      ])!;

      const layout = computeLayout(tree);
      const root = layout.nodes.find((n) => n.id === 'root')!;
      expect(root.lines.length).toBeGreaterThanOrEqual(1);
      expect(root.lines.join(' ')).toBe('A long root label for wrapping test purposes here');
    });

    it('links have points arrays', () => {
      const tree = buildTree([
        { id: 'root', label: 'Root', children: ['a'] },
        { id: 'a', label: 'A' },
      ])!;

      const layout = computeLayout(tree);
      expect(layout.links).toHaveLength(1);
      expect(layout.links[0].points.length).toBeGreaterThanOrEqual(2);
      expect(layout.links[0].points[0]).toHaveProperty('x');
      expect(layout.links[0].points[0]).toHaveProperty('y');
    });
  });

  describe('rendering', () => {
    it('renders the mindmap title', () => {
      const comp = makeMindmapComponent();
      render(<A2UIMindmap component={comp} surfaceId="s1" onAction={noopAction} />);
      expect(screen.getByText('Test Mindmap')).toBeInTheDocument();
    });

    it('renders SVG with nodes and links', () => {
      const comp = makeMindmapComponent();
      const { container } = render(
        <A2UIMindmap component={comp} surfaceId="s1" onAction={noopAction} />,
      );

      const svg = container.querySelector('.assistant-panel-mindmap-svg');
      expect(svg).not.toBeNull();

      // 4 nodes -> 4 rect
      const rects = container.querySelectorAll('.assistant-panel-mindmap-node');
      expect(rects).toHaveLength(4);

      const labels = container.querySelectorAll('.assistant-panel-mindmap-label');
      expect(labels).toHaveLength(4);

      // 3 links (root->a, root->b, a->a1)
      const links = container.querySelectorAll('.assistant-panel-mindmap-link');
      expect(links).toHaveLength(3);
    });

    it('renders all node labels', () => {
      const comp = makeMindmapComponent();
      const { container } = render(
        <A2UIMindmap component={comp} surfaceId="s1" onAction={noopAction} />,
      );

      const labels = container.querySelectorAll('.assistant-panel-mindmap-label');
      const labelTexts = Array.from(labels).map((el) => el.textContent);
      expect(labelTexts).toContain('Central Topic');
      expect(labelTexts).toContain('Branch A');
      expect(labelTexts).toContain('Branch B');
      expect(labelTexts).toContain('Leaf');
    });

    it('returns null when nodes array is empty', () => {
      const comp = makeMindmapComponent({}, []);
      const { container } = render(
        <A2UIMindmap component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      expect(container.querySelector('.assistant-panel-mindmap-svg')).toBeNull();
    });

    it('renders without title when not provided', () => {
      const comp = makeMindmapComponent({ properties: {} });
      const { container } = render(
        <A2UIMindmap component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      expect(container.querySelector('.assistant-panel-mindmap-title')).toBeNull();
      expect(container.querySelector('.assistant-panel-mindmap-svg')).not.toBeNull();
    });

    it('root node gets depth-0 color styling', () => {
      const comp = makeMindmapComponent({}, [
        { id: 'root', label: 'Root' },
      ]);
      const { container } = render(
        <A2UIMindmap component={comp} surfaceId="s1" onAction={noopAction} />,
      );

      const rect = container.querySelector('.assistant-panel-mindmap-node');
      expect(rect).not.toBeNull();
      expect(rect!.getAttribute('stroke-width')).toBe('2');
      expect(rect!.getAttribute('fill-opacity')).toBe('0.25');
    });

    it('child nodes get depth > 0 color styling', () => {
      const comp = makeMindmapComponent({}, [
        { id: 'root', label: 'Root', children: ['a'] },
        { id: 'a', label: 'A' },
      ]);
      const { container } = render(
        <A2UIMindmap component={comp} surfaceId="s1" onAction={noopAction} />,
      );

      const rects = container.querySelectorAll('.assistant-panel-mindmap-node');
      expect(rects).toHaveLength(2);

      // Second rect is the child
      const childRect = rects[1];
      expect(childRect.getAttribute('stroke-width')).toBe('1');
      expect(childRect.getAttribute('fill-opacity')).toBe('0.15');
    });

    it('renders multi-line labels with tspan elements', () => {
      const comp = makeMindmapComponent({}, [
        { id: 'root', label: 'This is a very long label that should definitely wrap into multiple lines in the mindmap' },
      ]);
      const { container } = render(
        <A2UIMindmap component={comp} surfaceId="s1" onAction={noopAction} />,
      );

      const tspans = container.querySelectorAll('tspan');
      expect(tspans.length).toBeGreaterThan(1);
    });
  });
});
