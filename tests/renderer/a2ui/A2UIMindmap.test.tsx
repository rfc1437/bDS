import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { A2UIMindmap, buildTree, computeLayout, splitChildren } from '../../../src/renderer/a2ui/components/A2UIMindmap';
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

  describe('splitChildren', () => {
    it('returns empty arrays for no children', () => {
      const { right, left } = splitChildren([]);
      expect(right).toHaveLength(0);
      expect(left).toHaveLength(0);
    });

    it('puts single child on the right', () => {
      const child: ReturnType<typeof buildTree> = { id: 'a', label: 'A', children: [] };
      const { right, left } = splitChildren([child!]);
      expect(right).toHaveLength(1);
      expect(left).toHaveLength(0);
    });

    it('splits two children across right and left', () => {
      const a = { id: 'a', label: 'A', children: [] };
      const b = { id: 'b', label: 'B', children: [] };
      const { right, left } = splitChildren([a, b]);
      expect(right).toHaveLength(1);
      expect(left).toHaveLength(1);
    });

    it('balances by subtree size', () => {
      // 'a' has 3 leaves, 'b' has 1 leaf, 'c' has 1 leaf
      const a = { id: 'a', label: 'A', children: [
        { id: 'a1', label: 'A1', children: [] },
        { id: 'a2', label: 'A2', children: [] },
        { id: 'a3', label: 'A3', children: [] },
      ] };
      const b = { id: 'b', label: 'B', children: [] };
      const c = { id: 'c', label: 'C', children: [] };
      const { right, left } = splitChildren([a, b, c]);
      // 'a' (weight 3) goes right, then 'b' (weight 1) goes left (0 < 3),
      // 'c' (weight 1) also goes left (1 < 3)
      expect(right.map((n) => n.id)).toContain('a');
      expect(left.length).toBeGreaterThanOrEqual(1);
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

    it('places root between left and right children', () => {
      const tree = buildTree([
        { id: 'root', label: 'Root', children: ['a', 'b'] },
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ])!;

      const layout = computeLayout(tree);
      const root = layout.nodes.find((n) => n.id === 'root')!;
      const nodeA = layout.nodes.find((n) => n.id === 'a')!;
      const nodeB = layout.nodes.find((n) => n.id === 'b')!;

      // With 2 children, one should be to the right of root, one to the left
      const rightChild = nodeA.x > root.x ? nodeA : nodeB;
      const leftChild = nodeA.x > root.x ? nodeB : nodeA;
      expect(rightChild.x).toBeGreaterThan(root.x);
      expect(leftChild.x).toBeLessThan(root.x);
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

      // 4 nodes → 4 rect + 4 text
      const rects = container.querySelectorAll('.assistant-panel-mindmap-node');
      expect(rects).toHaveLength(4);

      const labels = container.querySelectorAll('.assistant-panel-mindmap-label');
      expect(labels).toHaveLength(4);

      // 3 links (root→a, root→b, a→a1)
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
  });
});
