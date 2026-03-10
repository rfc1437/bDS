/**
 * A2UI Mindmap Component
 *
 * Renders a centered mind map diagram using dagre for automatic graph layout
 * with variable-sized nodes, word wrapping, and multi-line labels.
 *
 * Layout strategy:
 * - Dagre arranges the tree left-to-right (rankdir: LR)
 * - Each node has dynamically computed width/height based on wrapped text lines
 * - Links follow dagre routed edge points, rendered as SVG cubic curves
 */

import React, { useMemo } from 'react';
import dagre from '@dagrejs/dagre';
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

export interface TreeNode {
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

/* ── Constants ──────────────────────────────────────────────── */

const FONT_SIZE = 13;
const CHAR_WIDTH = 7.8;
export const LINE_HEIGHT = 18;
const NODE_PADDING_X = 14;
const NODE_PADDING_Y = 8;
const NODE_RADIUS = 6;
export const MAX_NODE_WIDTH = 180;
const MIN_NODE_WIDTH = 50;
const NODE_SEP = 18;
const RANK_SEP = 40;

/* ── Text wrapping ──────────────────────────────────────────── */

/** Break a label into wrapped lines that fit within maxWidth (in px). */
export function wrapText(text: string, maxWidth: number): string[] {
  const maxChars = Math.max(Math.floor(maxWidth / CHAR_WIDTH), 4);
  const words = text.split(/\s+/);
  if (words.length === 0) return [text];

  const lines: string[] = [];
  let currentLine = words[0];

  for (let i = 1; i < words.length; i++) {
    const candidate = currentLine + ' ' + words[i];
    if (candidate.length <= maxChars) {
      currentLine = candidate;
    } else {
      lines.push(currentLine);
      currentLine = words[i];
    }
  }
  lines.push(currentLine);
  return lines;
}

/** Estimate text width in px for a single line. */
function estimateTextWidth(text: string): number {
  return Math.max(text.length * CHAR_WIDTH, MIN_NODE_WIDTH);
}

/** Compute node box dimensions from wrapped lines. */
export function nodeSize(label: string): { width: number; height: number; lines: string[] } {
  const innerMax = MAX_NODE_WIDTH - NODE_PADDING_X * 2;
  const singleLineWidth = estimateTextWidth(label);

  // If single line fits, use it
  if (singleLineWidth <= innerMax) {
    const width = Math.max(singleLineWidth + NODE_PADDING_X * 2, MIN_NODE_WIDTH);
    return { width, height: LINE_HEIGHT + NODE_PADDING_Y * 2, lines: [label] };
  }

  // Wrap text
  const lines = wrapText(label, innerMax);
  const longestLine = Math.max(...lines.map((l) => estimateTextWidth(l)));
  const width = Math.min(Math.max(longestLine + NODE_PADDING_X * 2, MIN_NODE_WIDTH), MAX_NODE_WIDTH);
  const height = lines.length * LINE_HEIGHT + NODE_PADDING_Y * 2;
  return { width, height, lines };
}

/* ── Tree building ──────────────────────────────────────────── */

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

/* ── Layout (dagre) ─────────────────────────────────────────── */

export interface PositionedNode {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  lines: string[];
}

export interface LayoutResult {
  svgWidth: number;
  svgHeight: number;
  nodes: PositionedNode[];
  links: Array<{ points: Array<{ x: number; y: number }> }>;
}

/** Compute dagre layout for the full tree. */
export function computeLayout(root: TreeNode): LayoutResult {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: 'LR',
    nodesep: NODE_SEP,
    ranksep: RANK_SEP,
    marginx: 16,
    marginy: 16,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Recursively add nodes and edges
  function addNode(node: TreeNode, depth: number): void {
    const size = nodeSize(node.label);
    g.setNode(node.id, {
      label: node.label,
      width: size.width,
      height: size.height,
      depth,
      lines: size.lines,
    });
    for (const child of node.children) {
      addNode(child, depth + 1);
      g.setEdge(node.id, child.id);
    }
  }

  addNode(root, 0);
  dagre.layout(g);

  const nodes: PositionedNode[] = g.nodes().map((id) => {
    const n = g.node(id) as any;
    return {
      id,
      label: n.label,
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
      depth: n.depth ?? 0,
      lines: n.lines ?? [n.label],
    };
  });

  const links = g.edges().map((e) => {
    const edge = g.edge(e);
    return { points: edge.points };
  });

  const graphLabel = g.graph();
  return {
    svgWidth: (graphLabel.width ?? 400) as number,
    svgHeight: (graphLabel.height ?? 200) as number,
    nodes,
    links,
  };
}

/* ── SVG path from dagre edge points ────────────────────────── */

function edgePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${points[0].x},${points[0].y}`;

  let d = `M${points[0].x},${points[0].y}`;

  if (points.length === 2) {
    d += ` L${points[1].x},${points[1].y}`;
    return d;
  }

  // Smooth cubic curves through edge points
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const cpx = (prev.x + curr.x) / 2;
    d += ` C${cpx},${prev.y} ${cpx},${curr.y} ${curr.x},${curr.y}`;
  }

  return d;
}

/* ── Component ──────────────────────────────────────────────── */

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
        <defs>
          <marker
            id={`${component.id}-arrow`}
            viewBox="0 0 10 6"
            refX="9"
            refY="3"
            markerWidth="8"
            markerHeight="6"
            orient="auto"
          >
            <path
              d="M0,0 L10,3 L0,6"
              className="assistant-panel-mindmap-arrow"
            />
          </marker>
        </defs>
        {/* Links */}
        {layout.links.map((link, i) => (
          <path
            key={`${component.id}-link-${i}`}
            className="assistant-panel-mindmap-link"
            d={edgePath(link.points)}
            fill="none"
            markerEnd={`url(#${component.id}-arrow)`}
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
                y={node.y - node.height / 2}
                width={node.width}
                height={node.height}
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
                fontSize={FONT_SIZE}
              >
                {node.lines.length === 1 ? (
                  node.lines[0]
                ) : (
                  node.lines.map((line, li) => (
                    <tspan
                      key={li}
                      x={node.x}
                      dy={li === 0
                        ? -((node.lines.length - 1) * LINE_HEIGHT) / 2
                        : LINE_HEIGHT}
                    >
                      {line}
                    </tspan>
                  ))
                )}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};
