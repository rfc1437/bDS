import { EventEmitter } from 'events';

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface TaskProgress {
  taskId: string;
  name: string;
  status: TaskStatus;
  progress: number; // 0-100
  message: string;
  startTime: Date;
  endTime?: Date;
  error?: string;
  groupId?: string;
  groupName?: string;
}

export interface Task<T = unknown> {
  id: string;
  name: string;
  execute: (onProgress: (progress: number, message: string) => void) => Promise<T>;
  cancel?: () => void;
  groupId?: string;
  groupName?: string;
}

export class TaskManager extends EventEmitter {
  private tasks: Map<string, TaskProgress> = new Map();
  private runningTasks: Map<string, AbortController> = new Map();
  private maxConcurrentTasks = 3;
  private taskQueue: Task[] = [];

  constructor() {
    super();
  }

  getTaskStatus(taskId: string): TaskProgress | undefined {
    return this.tasks.get(taskId);
  }

  getAllTasks(): TaskProgress[] {
    return Array.from(this.tasks.values());
  }

  getRunningTasks(): TaskProgress[] {
    return Array.from(this.tasks.values()).filter(t => t.status === 'running');
  }

  async runTask<T>(task: Task<T>): Promise<T> {
    const progress: TaskProgress = {
      taskId: task.id,
      name: task.name,
      status: 'pending',
      progress: 0,
      message: 'Waiting to start...',
      startTime: new Date(),
      groupId: task.groupId,
      groupName: task.groupName,
    };

    this.tasks.set(task.id, progress);
    this.emit('taskCreated', progress);

    // Check if we can run immediately or need to queue
    if (this.runningTasks.size >= this.maxConcurrentTasks) {
      this.taskQueue.push(task as Task);
      this.emit('taskQueued', progress);
      
      // Wait until we can run
      await new Promise<void>(resolve => {
        const checkQueue = () => {
          if (this.runningTasks.size < this.maxConcurrentTasks) {
            const queueIndex = this.taskQueue.findIndex(t => t.id === task.id);
            if (queueIndex !== -1) {
              this.taskQueue.splice(queueIndex, 1);
            }
            resolve();
          } else {
            setTimeout(checkQueue, 100);
          }
        };
        checkQueue();
      });
    }

    const abortController = new AbortController();
    this.runningTasks.set(task.id, abortController);

    progress.status = 'running';
    progress.message = 'Starting...';
    this.emit('taskStarted', progress);

    try {
      let lastEmitTime = 0;
      const THROTTLE_MS = 250; // Only emit progress to renderer every 250ms

      const result = await task.execute((progressValue, message) => {
        if (abortController.signal.aborted) {
          throw new Error('Task cancelled');
        }
        progress.progress = progressValue;
        progress.message = message;
        const now = Date.now();
        if (now - lastEmitTime >= THROTTLE_MS || progressValue >= 100) {
          lastEmitTime = now;
          this.emit('taskProgress', { ...progress });
        }
      });

      progress.status = 'completed';
      progress.progress = 100;
      progress.message = 'Completed';
      progress.endTime = new Date();
      this.emit('taskCompleted', progress);

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      if (errorMessage === 'Task cancelled') {
        progress.status = 'cancelled';
        progress.message = 'Cancelled';
      } else {
        progress.status = 'failed';
        progress.error = errorMessage;
        progress.message = `Failed: ${errorMessage}`;
      }
      
      progress.endTime = new Date();
      this.emit('taskFailed', progress);
      
      throw error;
    } finally {
      this.runningTasks.delete(task.id);
      this.processQueue();
    }
  }

  cancelTask(taskId: string): boolean {
    const controller = this.runningTasks.get(taskId);
    if (controller) {
      controller.abort();
      return true;
    }

    // Check if in queue
    const queueIndex = this.taskQueue.findIndex(t => t.id === taskId);
    if (queueIndex !== -1) {
      this.taskQueue.splice(queueIndex, 1);
      const progress = this.tasks.get(taskId);
      if (progress) {
        progress.status = 'cancelled';
        progress.message = 'Cancelled (was queued)';
        progress.endTime = new Date();
        this.emit('taskCancelled', progress);
      }
      return true;
    }

    return false;
  }

  private processQueue(): void {
    if (this.taskQueue.length > 0 && this.runningTasks.size < this.maxConcurrentTasks) {
      // Queue processing happens automatically via the waiting promises
      this.emit('queueProcessing');
    }
  }

  clearCompletedTasks(): void {
    for (const [id, task] of this.tasks) {
      if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
        this.tasks.delete(id);
      }
    }
    this.emit('tasksCleared');
  }
}

// Singleton instance
export const taskManager = new TaskManager();
