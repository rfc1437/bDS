import React, { useState } from 'react';
import type { AssistantPanelElement } from '../../navigation/assistantPanelSpec';
import './AssistantPanelControls.css';

interface AssistantPanelControlsProps {
  elements: AssistantPanelElement[];
  onAction: (action: string, payload?: Record<string, unknown>) => void;
  actionPolicies?: Record<string, 'silent' | 'confirm' | 'danger'>;
}

export const AssistantPanelControls: React.FC<AssistantPanelControlsProps> = ({ elements, onAction, actionPolicies = {} }) => {
  const [widgetValues, setWidgetValues] = useState<Record<string, unknown>>({});
  const [activeTabByWidget, setActiveTabByWidget] = useState<Record<string, string>>({});

  const setWidgetValue = (key: string, value: unknown) => {
    setWidgetValues((previous) => ({
      ...previous,
      [key]: value,
    }));
  };

  const getWidgetValue = (key: string, defaultValue?: unknown) =>
    Object.prototype.hasOwnProperty.call(widgetValues, key) ? widgetValues[key] : defaultValue;

  const triggerAction = (action: string, payload?: Record<string, unknown>, label?: string) => {
    const policy = actionPolicies[action] || 'silent';

    if (policy !== 'silent') {
      const confirmationText = label || action;
      const confirmed = window.confirm(confirmationText);
      if (!confirmed) {
        return;
      }
    }

    onAction(action, payload);
  };

  const renderInputControl = (
    key: string,
    label: string,
    inputType: 'text' | 'textarea' | 'select' | 'checkbox' | 'date' | 'number',
    options?: Array<{ label: string; value: string }>,
    placeholder?: string,
    defaultValue?: string | number | boolean,
  ) => {
    if (inputType === 'textarea') {
      return (
        <textarea
          className="assistant-panel-widget-input chat-surface-input"
          value={String(getWidgetValue(key, defaultValue ?? ''))}
          placeholder={placeholder}
          onChange={(event) => setWidgetValue(key, event.target.value)}
          rows={3}
        />
      );
    }

    if (inputType === 'select') {
      return (
        <select
          className="assistant-panel-widget-input chat-surface-input"
          value={String(getWidgetValue(key, defaultValue ?? (options?.[0]?.value ?? '')))}
          onChange={(event) => setWidgetValue(key, event.target.value)}
        >
          {(options ?? []).map((option) => (
            <option key={`${key}-${option.value}`} value={option.value}>{option.label}</option>
          ))}
        </select>
      );
    }

    if (inputType === 'checkbox') {
      return (
        <label className="assistant-panel-checkbox">
          <input
            type="checkbox"
            checked={Boolean(getWidgetValue(key, defaultValue ?? false))}
            onChange={(event) => setWidgetValue(key, event.target.checked)}
          />
          <span>{label}</span>
        </label>
      );
    }

    const type = inputType === 'number' ? 'number' : inputType === 'date' ? 'date' : 'text';
    return (
      <input
        className="assistant-panel-widget-input chat-surface-input"
        type={type}
        value={String(getWidgetValue(key, defaultValue ?? ''))}
        placeholder={placeholder}
        onChange={(event) => setWidgetValue(key, event.target.value)}
      />
    );
  };

  const renderPanelElement = (element: AssistantPanelElement, indexPath: string): React.ReactNode => {
    if (element.type === 'text') {
      return <p key={`assistant-element-${indexPath}`}>{element.text}</p>;
    }

    if (element.type === 'metric') {
      return (
        <div key={`assistant-element-${indexPath}`} className="assistant-panel-metric">
          <span className="assistant-panel-metric-label">{element.label}</span>
          <strong className="assistant-panel-metric-value">{element.value}</strong>
        </div>
      );
    }

    if (element.type === 'list') {
      return (
        <div key={`assistant-element-${indexPath}`}>
          {element.title && <p>{element.title}</p>}
          <ul>
            {element.items.map((item, itemIndex) => <li key={`assistant-list-item-${indexPath}-${itemIndex}`}>{item}</li>)}
          </ul>
        </div>
      );
    }

    if (element.type === 'table') {
      return (
        <table key={`assistant-element-${indexPath}`} className="assistant-panel-table">
          <thead>
            <tr>
              {element.columns.map((column, columnIndex) => <th key={`assistant-table-column-${indexPath}-${columnIndex}`}>{column}</th>)}
            </tr>
          </thead>
          <tbody>
            {element.rows.map((row, rowIndex) => (
              <tr key={`assistant-table-row-${indexPath}-${rowIndex}`}>
                {row.map((cell, cellIndex) => <td key={`assistant-table-cell-${indexPath}-${rowIndex}-${cellIndex}`}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    if (element.type === 'chart') {
      const maxValue = Math.max(...element.series.map((item) => item.value), 0);
      return (
        <div key={`assistant-element-${indexPath}`} className="assistant-panel-chart">
          {element.title && <p className="assistant-panel-chart-title">{element.title}</p>}
          <div className="assistant-panel-chart-type">{element.chartType}</div>
          {element.series.map((entry, seriesIndex) => (
            <div key={`assistant-chart-item-${indexPath}-${seriesIndex}`} className="assistant-panel-chart-item">
              <span>{entry.label}</span>
              <progress value={entry.value} max={maxValue || 1}></progress>
              <span>{entry.value}</span>
            </div>
          ))}
        </div>
      );
    }

    if (element.type === 'input') {
      const currentValue = getWidgetValue(element.key, element.defaultValue);
      return (
        <div key={`assistant-element-${indexPath}`} className="assistant-panel-widget-block">
          {element.inputType !== 'checkbox' && <label className="assistant-panel-widget-label">{element.label}</label>}
          {renderInputControl(element.key, element.label, element.inputType, element.options, element.placeholder, element.defaultValue)}
          {element.action && element.submitLabel && (
            <button
              type="button"
              onClick={() => triggerAction(element.action!, { ...(element.payload ?? {}), [element.key]: currentValue }, element.submitLabel)}
            >
              {element.submitLabel}
            </button>
          )}
        </div>
      );
    }

    if (element.type === 'datePicker') {
      const currentValue = String(getWidgetValue(element.key, element.defaultValue ?? ''));
      return (
        <div key={`assistant-element-${indexPath}`} className="assistant-panel-widget-block">
          <label className="assistant-panel-widget-label">{element.label}</label>
          <input
            className="assistant-panel-widget-input chat-surface-input"
            type="date"
            min={element.min}
            max={element.max}
            value={currentValue}
            onChange={(event) => setWidgetValue(element.key, event.target.value)}
          />
          {element.action && element.submitLabel && (
            <button
              type="button"
              onClick={() => triggerAction(element.action!, { ...(element.payload ?? {}), [element.key]: currentValue }, element.submitLabel)}
            >
              {element.submitLabel}
            </button>
          )}
        </div>
      );
    }

    if (element.type === 'form') {
      const onSubmit = () => {
        const values = element.fields.reduce<Record<string, unknown>>((accumulator, field) => {
          accumulator[field.key] = getWidgetValue(field.key, field.defaultValue);
          return accumulator;
        }, {});

        triggerAction(element.action, {
          ...(element.payload ?? {}),
          formId: element.formId,
          values,
        }, element.submitLabel);
      };

      return (
        <div key={`assistant-element-${indexPath}`} className="assistant-panel-form">
          {element.title && <p className="assistant-panel-form-title">{element.title}</p>}
          {element.fields.map((field, fieldIndex) => (
            <div key={`assistant-form-field-${indexPath}-${fieldIndex}`} className="assistant-panel-widget-block">
              {field.inputType !== 'checkbox' && <label className="assistant-panel-widget-label">{field.label}</label>}
              {renderInputControl(field.key, field.label, field.inputType, field.options, field.placeholder, field.defaultValue)}
            </div>
          ))}
          <button type="button" onClick={onSubmit}>{element.submitLabel}</button>
        </div>
      );
    }

    if (element.type === 'card') {
      return (
        <article key={`assistant-element-${indexPath}`} className="assistant-panel-card">
          <h4>{element.title}</h4>
          {element.subtitle && <p className="assistant-panel-card-subtitle">{element.subtitle}</p>}
          <p>{element.body}</p>
          {element.actions && element.actions.length > 0 && (
            <div className="assistant-panel-card-actions">
              {element.actions.map((action, actionIndex) => (
                <button
                  key={`assistant-card-action-${indexPath}-${actionIndex}`}
                  type="button"
                  onClick={() => triggerAction(action.action, action.payload, action.label)}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </article>
      );
    }

    if (element.type === 'image') {
      return (
        <figure key={`assistant-element-${indexPath}`} className="assistant-panel-image">
          <img
            src={element.src}
            alt={element.alt || ''}
            onClick={() => {
              if (element.action) {
                triggerAction(element.action, element.payload, element.caption || element.alt || element.action);
              }
            }}
          />
          {element.caption && <figcaption>{element.caption}</figcaption>}
        </figure>
      );
    }

    if (element.type === 'tabs') {
      const widgetKey = element.widgetId || `tabs-${indexPath}`;
      const activeTabId = activeTabByWidget[widgetKey] || element.defaultTabId || element.tabs[0].id;
      const activeTab = element.tabs.find((tab) => tab.id === activeTabId) ?? element.tabs[0];

      return (
        <div key={`assistant-element-${indexPath}`} className="assistant-panel-tabs">
          <div className="assistant-panel-tab-strip">
            {element.tabs.map((tab) => (
              <button
                key={`assistant-tab-${indexPath}-${tab.id}`}
                type="button"
                className={`assistant-panel-tab-button ${tab.id === activeTab.id ? 'active' : ''}`}
                onClick={() => setActiveTabByWidget((previous) => ({ ...previous, [widgetKey]: tab.id }))}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="assistant-panel-tab-panel">
            {activeTab.elements.map((childElement, childIndex) => renderPanelElement(childElement, `${indexPath}-tab-${childIndex}`))}
          </div>
        </div>
      );
    }

    return (
      <button key={`assistant-element-${indexPath}`} type="button" onClick={() => triggerAction(element.action, element.payload, element.label)}>
        {element.label}
      </button>
    );
  };

  return (
    <div className="assistant-panel-controls chat-surface-section">
      {elements.map((element, index) => renderPanelElement(element, `${index}`))}
    </div>
  );
};

export default AssistantPanelControls;