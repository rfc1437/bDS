import {
  getActivityClickActions,
  type ActivityAction,
  type ActivityId,
  type ActivitySnapshot,
} from './activityBehavior';
import type { SidebarView } from './sidebarViewRegistry';

export interface ActivityExecutionHandlers {
  setActiveView: (view: SidebarView) => void;
  toggleSidebar: () => void;
}

export function executeActivityClickActions(
  actions: ActivityAction[],
  handlers: ActivityExecutionHandlers,
): void {
  for (const action of actions) {
    if (action.type === 'toggleSidebar') {
      handlers.toggleSidebar();
      continue;
    }

    handlers.setActiveView(action.view);
  }
}

export function executeActivityClick(
  snapshot: ActivitySnapshot,
  activityId: ActivityId,
  handlers: ActivityExecutionHandlers,
): void {
  executeActivityClickActions(getActivityClickActions(snapshot, activityId), handlers);
}
