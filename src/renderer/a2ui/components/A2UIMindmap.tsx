/**
 * A2UI Mindmap Component
 *
 * Renders a centered mind map diagram using d3-hierarchy for tree layout
 * and d3-shape for curved link paths, with inline SVG output.
 *
 * Layout strategy (classic mindmap):
 * - Root node sits at the horizontal center
 * - Children are split into two balanced groups: right half and left half
 * - Each half is laid out as a vertical tree using d3.tree()
 * - Left-side trees are mirrored horizontally
 * - Horizontal spacing accounts for actual label widths to prevent overlap
 */

import React, { useMemo } from 'react';
import { hierarchy, tree as d3tree, type HierarchyPointNode } from 'd3-hierarchy';
import { linkHorizontal } from 'd3-shape';
import type { A2UIResolvedComponent, A2UIClientAction } from '../../../main/a2ui/types';

interface A2UIComponentProps {
  component: A2UIResolvedComponent;
  surfaceId: string;
  onAction: (action: A2UIClientAction) => void;
  onDataChange?: (surfaceId: string, path: string, value: unknown) => void;
  renderChildren?: (children: A2UIResolvedComponent[]) => React.ReactNode;
}

interface MindmapNode {
  id: string;
  label: string;
  children?: string[];
}

interface TreeNode {
  id: string;
  label: string;
  children: TreeNode[];
}

const NODE_COLORS = [
  'var(--vscode-charts-blue, #75beff)',
  'var(--vscode-charts-green, #89d185)',
  'var(--vscode-charts-orange, #d18616)',
  'var(--vscode-charts-purple, #b180d7)',
  'var(--vscode-charts-red, #f14c4c)',
  'var(--vscode-charts-yellow, #e2e210)',
];

function getNodeColor(depth: number): string {
  if (depth === 0) return 'var(--vscode-focusBorder, #007fd4)';
  return NODE_COLORS[(depth - 1) % NODE_COLORS.length];
}

/** Build a nested tree from a flat node array. First node is the root. */
export function buildTree(nodes: MindmapNode[]): TreeNode | null {
  if (nodes.length === 0) return null;

  const nodeMap = new Map<string, MindmapNode>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  function toTreeNode(id: string): TreeNode | null {
    const node = nodeMap.get(id);
    if (!node) return null;
    const children: TreeNode[] = [];
    if (node.children) {
      for (const childId of node.children) {
        const child = toTreeNode(childId);
        if (child) children.push(child);
      }
    }
    return { id: node.id, label: node.label, children };
  }

  return toTreeNode(nodes[0].id);
}

/** Estimate text width in pixels (rough: 7px per char at 12px font). */
function estimateTextWidth(text: string): number {
  return Math.max(text.length * 7, 40);
}

/** Compute node box width from label. */
function nodeWidth(label: string): number {
  return estimateTextWidth(label) + NODE_PADDING_X * 2;
}

const NODE_HEIGHT = 28;
const NODE_PADDING_X = 12;
const NODE_RADIUS = 6;
const VERTICAL_GAP = 10;
const HORIZONTAL_GAP = 24;

/** Count total descendant leaves for balancing. */
function leafCount(node: TreeNode): number {
  if (node.children.length === 0) return 1;
  let count = 0;
  for (const child of node.children) {
    count += leafCount(child);
  }
  return count;
}

/**
 * Split root children into right and left groups, balanced by subtree size.
 * Uses a greedy approach: assign children to the smaller side.
 */
export function splitChildren(children: TreeNode[]): { right: TreeNode[]; left: TreeNode[] } {
  if (children.length === 0) return { right: [], left: [] };
  if (children.length === 1) return { right: children, left: [] };

  // Compute weights (leaf counts) for each child subtree
  const weighted = children.map((child) => ({ child, weight: leafCount(child) }));

  const right: TreeNode[] = [];
  const left: TreeNode[] = [];
  let rightWeight = 0;
  let leftWeight = 0;

  for (const { child, weight } of weighted) {
    if (rightWeight <= leftWeight) {
      right.push(child);
      rightWeight += weight;
    } else {
      left.push(child);
      leftWeight += weight;
    }
  }

  return { right, left };
}

interface PositionedNode {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  depth: number;
}

interface LayoutResult {
  svgWidth: number;
  svgHeight: number;
  nodes: PositionedNode[];
  links: Array<{
    source: { x: number; y: number };
    target: { x: number; y: number };
  }>;
}

/**
 * Compute the maximum node width at each depth level of a d3 hierarchy tree.
 * Used to set proper horizontal spacing per level so nodes don't overlap.
 */
function maxWidthPerDepth(root: HierarchyPointNode<TreeNode>): Map<number, number> {
  const widths = new Map<number, number>();
  for (const n of root.descendants()) {
    const w = nodeWidth(n.data.label);
    const current = widths.get(n.depth) ?? 0;
    if (w > current) widths.set(n.depth, w);
  }
  return widths;
}

/**
 * Lay out one side (right or left) of the mindmap.
 * Creates a virtual root to act as connection point, then runs d3.tree().
 * Returns positioned nodes (excluding virtual root) and links.
 *
 * @param side 'right' = nodes extend rightward (positive x), 'left' = mirrored
 * @param children The children that go on this side
 * @param rootId ID of the real root node (for link origins)
 * @param depthOffset Depth offset (1, since these are children of root)
 */
function layoutSide(
  side: 'right' | 'left',
  children: TreeNode[],
  rootId: string,
  rootX: number,
  rootY: number,
): { nodes: PositionedNode[]; links: LayoutResult['links'] } {
  if (children.length === 0) return { nodes: [], links: [] };

  // Create a virtual root that holds the side's children
  const virtualRoot: TreeNode = { id: `__virtual_${side}`, label: '', children };
  const h = hierarchy(virtualRoot, (d) => (d.children.length > 0 ? d.children : null));

  const nodeVSpacing = NODE_HEIGHT + VERTICAL_GAP;
  const treeLayout = d3tree<TreeNode>().nodeSize([nodeVSpacing, 1]);
  const treeRoot = treeLayout(h);

  // Compute max widths per depth to set proper horizontal offsets
  const depthWidths = maxWidthPerDepth(treeRoot);

  // Compute cumulative x offset for each depth level
  // depth 0 = virtual root (at rootX), depth 1 = first children, etc.
  const depthX = new Map<number, number>();
  depthX.set(0, 0);
  let cumulativeX = 0;
  const maxDepth = Math.max(...depthWidths.keys());
  for (let d = 1; d <= maxDepth; d++) {
    const parentWidth = depthWidths.get(d - 1) ?? 60;
    const currentWidth = depthWidths.get(d) ?? 60;
    cumulativeX += parentWidth / 2 + HORIZONTAL_GAP + currentWidth / 2;
    depthX.set(d, cumulativeX);
  }

  const mirror = side === 'left' ? -1 : 1;
  const nodes: PositionedNode[] = [];
  const links: LayoutResult['links'] = [];

  for (const n of treeRoot.descendants()) {
    // Skip virtual root
    if (n.depth === 0) continue;

    const w = nodeWidth(n.data.label);
    const xOffset = depthX.get(n.depth) ?? 0;

    nodes.push({
      id: n.data.id,
      label: n.data.label,
      x: rootX + mirror * xOffset,
      // d3.tree: x = vertical position, y = depth (but we computed our own x)
      y: rootY + n.x,
      width: w,
      depth: n.depth, // depth relative to virtual root; real depth = n.depth
    });
  }

  // Build links
  for (const link of treeRoot.links()) {
    if (link.source.depth === 0) {
      // Link from real root to first-level children
      const targetNode = nodes.find((n) => n.id === link.target.data.id);
      if (targetNode) {
        const rootW = nodeWidth(''); // Will be overridden by caller
        links.push({
          source: { x: rootX, y: rootY },
          target: {
            x: targetNode.x + (side === 'left' ? targetNode.width / 2 : -targetNode.width / 2),
            y: targetNode.y,
          },
        });
      }
    } else {
      const sourceNode = nodes.find((n) => n.id === link.source.data.id);
      const targetNode = nodes.find((n) => n.id === link.target.data.id);
      if (sourceNode && targetNode) {
        links.push({
          source: {
            x: sourceNode.x + (side === 'left' ? -sourceNode.width / 2 : sourceNode.width / 2),
            y: sourceNode.y,
          },
          target: {
            x: targetNode.x + (side === 'left' ? targetNode.width / 2 : -targetNode.width / 2),
            y: targetNode.y,
          },
        });
      }
    }
  }

  return { nodes, links };
}

export function computeLayout(root: TreeNode): LayoutResult {
  const rootW = nodeWidth(root.label);

  // Single node — just center it
  if (root.children.length === 0) {
    const pad = 16;
    return {
      svgWidth: rootW + pad * 2,
      svgHeight: NODE_HEIGHT + pad * 2,
      nodes: [{
        id: root.id,
        label: root.label,
        x: rootW / 2 + pad,
        y: NODE_HEIGHT / 2 + pad,
        width: rootW,
        depth: 0,
      }],
      links: [],
    };
  }

  // Split children into right and left sides for balanced layout
  const { right, left } = splitChildren(root.children);

  // Root starts at origin (0, 0) — we'll translate after
  const rootX = 0;
  const rootY = 0;

  const rightResult = layoutSide('right', right, root.id, rootX, rootY);
  const leftResult = layoutSide('left', left, root.id, rootX, rootY);

  // Merge all nodes
  const allNodes: PositionedNode[] = [
    { id: root.id, label: root.label, x: rootX, y: rootY, width: rootW, depth: 0 },
    ...rightResult.nodes.map((n) => ({ ...n, depth: n.depth })),
    ...leftResult.nodes.map((n) => ({ ...n, depth: n.depth })),
  ];

  // Fix root→child links to use actual root width
  const fixRootLinks = (links: LayoutResult['links'], side: 'right' | 'left') =>
    links.map((l) => {
      if (l.source.x === rootX && l.source.y === rootY) {
        return {
          source: {
            x: rootX + (side === 'right' ? rootW / 2 : -rootW / 2),
            y: rootY,
          },
          target: l.target,
        };
      }
      return l;
    });

  const allLinks = [
    ...fixRootLinks(rightResult.links, 'right'),
    ...fixRootLinks(leftResult.links, 'left'),
  ];

  // Compute bounding box
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const n of allNodes) {
    const l = n.x - n.width / 2;
    const r = n.x + n.width / 2;
    const t = n.y - NODE_HEIGHT / 2;
    const b = n.y + NODE_HEIGHT / 2;
    if (l < minX) minX = l;
    if (r > maxX) maxX = r;
    if (t < minY) minY = t;
    if (b > maxY) maxY = b;
  }

  const pad = 16;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;

  const offsetX = -minX;
  const offsetY = -minY;

  return {
    svgWidth: maxX - minX,
    svgHeight: maxY - minY,
    nodes: allNodes.map((n) => ({ ...n, x: n.x + offsetX, y: n.y + offsetY })),
    links: allLinks.map((l) => ({
      source: { x: l.source.x + offsetX, y: l.source.y + offsetY },
      target: { x: l.target.x + offsetX, y: l.target.y + offsetY },
    })),
  };
}

const linkGenerator = linkHorizontal<
  { source: { x: number; y: number }; target: { x: number; y: number } },
  { x: number; y: number }
>()
  .x((d) => d.x)
  .y((d) => d.y);

export const A2UIMindmap: React.FC<A2UIComponentProps> = ({ component }) => {
  const title = component.properties.title as string | undefined;
  const nodes = (component.boundValue as MindmapNode[]) ??
    (component.properties.nodes as MindmapNode[]) ?? [];

  const layout = useMemo(() => {
    const root = buildTree(nodes);
    if (!root) return null;
    return computeLayout(root);
  }, [nodes]);

  if (!layout) return null;

  return (
    <div className="assistant-panel-mindmap">
      {title && <p className="assistant-panel-mindmap-title">{title}</p>}
      <svg
        className="assistant-panel-mindmap-svg"
        viewBox={`0 0 ${layout.svgWidth} ${layout.svgHeight}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Links */}
        {layout.links.map((link, i) => (
          <path
            key={`${component.id}-link-${i}`}
            className="assistant-panel-mindmap-link"
            d={linkGenerator(link) ?? ''}
            fill="none"
          />
        ))}
        {/* Nodes */}
        {layout.nodes.map((node) => {
          const color = getNodeColor(node.depth);
          return (
            <g key={`${component.id}-node-${node.id}`}>
              <rect
                className="assistant-panel-mindmap-node"
                x={node.x - node.width / 2}
                y={node.y - NODE_HEIGHT / 2}
                width={node.width}
                height={NODE_HEIGHT}
                rx={NODE_RADIUS}
                ry={NODE_RADIUS}
                fill={color}
                fillOpacity={node.depth === 0 ? 0.25 : 0.15}
                stroke={color}
                strokeWidth={node.depth === 0 ? 2 : 1}
              >
                <title>{node.label}</title>
              </rect>
              <text
                className="assistant-panel-mindmap-label"
                x={node.x}
                y={node.y}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};
