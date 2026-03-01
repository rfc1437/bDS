/**
 * A2UI Mindmap Component
 *
 * Renders a mind map diagram using d3-hierarchy for layout
 * and d3-shape for link paths, with inline SVG output.
 */

import React, { useMemo } from 'react';
import { hierarchy, tree as d3tree } from 'd3-hierarchy';
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

const NODE_HEIGHT = 28;
const NODE_PADDING_X = 12;
const NODE_PADDING_Y = 6;
const NODE_RADIUS = 6;
const VERTICAL_GAP = 8;

interface LayoutResult {
  svgWidth: number;
  svgHeight: number;
  nodes: Array<{
    id: string;
    label: string;
    x: number;
    y: number;
    width: number;
    depth: number;
  }>;
  links: Array<{
    source: { x: number; y: number };
    target: { x: number; y: number };
  }>;
}

export function computeLayout(root: TreeNode): LayoutResult {
  const h = hierarchy(root, (d) => (d.children.length > 0 ? d.children : null));

  // Node sizes: [vertical spacing, horizontal spacing]
  const nodeVSpacing = NODE_HEIGHT + VERTICAL_GAP;
  const nodeHSpacing = 180;

  const treeLayout = d3tree<TreeNode>().nodeSize([nodeVSpacing, nodeHSpacing]);
  const treeRoot = treeLayout(h);

  // Collect all positioned nodes
  const allNodes = treeRoot.descendants();
  const allLinks = treeRoot.links();

  // Compute node widths based on label text
  const positioned = allNodes.map((n) => {
    const textW = estimateTextWidth(n.data.label);
    const width = textW + NODE_PADDING_X * 2;
    return {
      id: n.data.id,
      label: n.data.label,
      // d3.tree uses x for vertical, y for horizontal (depth axis)
      x: n.y, // horizontal position (depth)
      y: n.x, // vertical position
      width,
      depth: n.depth,
    };
  });

  // Compute links — connect right edge of source to left edge of target
  const nodeById = new Map(positioned.map((n) => [n.id, n]));
  const links = allLinks.map((link) => {
    const source = nodeById.get(link.source.data.id)!;
    const target = nodeById.get(link.target.data.id)!;
    return {
      source: { x: source.x + source.width / 2, y: source.y },
      target: { x: target.x - target.width / 2, y: target.y },
    };
  });

  // Compute bounding box
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const n of positioned) {
    const left = n.x - n.width / 2;
    const right = n.x + n.width / 2;
    const top = n.y - NODE_HEIGHT / 2;
    const bottom = n.y + NODE_HEIGHT / 2;
    if (left < minX) minX = left;
    if (right > maxX) maxX = right;
    if (top < minY) minY = top;
    if (bottom > maxY) maxY = bottom;
  }

  // Add padding
  const pad = 16;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;

  // Translate all coordinates so they start at (0,0)
  const offsetX = -minX;
  const offsetY = -minY;

  return {
    svgWidth: maxX - minX,
    svgHeight: maxY - minY,
    nodes: positioned.map((n) => ({
      ...n,
      x: n.x + offsetX,
      y: n.y + offsetY,
    })),
    links: links.map((l) => ({
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
