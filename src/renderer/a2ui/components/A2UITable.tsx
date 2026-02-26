import React from 'react';
import type { A2UIResolvedComponent, A2UIClientAction } from '../../../main/a2ui/types';

interface A2UIComponentProps {
  component: A2UIResolvedComponent;
  surfaceId: string;
  onAction: (action: A2UIClientAction) => void;
  onDataChange?: (surfaceId: string, path: string, value: unknown) => void;
  renderChildren?: (children: A2UIResolvedComponent[]) => React.ReactNode;
}

export const A2UITable: React.FC<A2UIComponentProps> = ({ component }) => {
  const columns = (component.properties.columns as string[]) ?? [];
  const rows = (component.boundValue as string[][]) ?? (component.properties.rows as string[][]) ?? [];
  const title = component.properties.title as string | undefined;

  return (
    <div>
      {title && <p>{title}</p>}
      <table className="assistant-panel-table">
        <thead>
          <tr>
            {columns.map((column, colIndex) => (
              <th key={`${component.id}-col-${colIndex}`}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${component.id}-row-${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                <td key={`${component.id}-cell-${rowIndex}-${cellIndex}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
