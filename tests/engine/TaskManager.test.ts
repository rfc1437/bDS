/**
 * TaskManager Unit Tests
 * 
 * Tests for the async task management system including:
 * - Task execution and progress tracking
 * - Task queuing and concurrency limits
 * - Task cancellation
 * - Event emissions
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskManager, Task, TaskProgress, TaskStatus } from '../../src/main/engine/TaskManager';
import { 
  createMockTask, 
  createMockSlowTask, 
  createMockFailingTask,
  resetMockCounters 
} from '../utils/factories';

describe('TaskManager', () => {
  let taskManager: TaskManager;

  beforeEach(() => {
    taskManager = new TaskManager();
    resetMockCounters();
  });

  describe('Task Execution', () => {
    it('should execute a task successfully', async () => {
      const task = createMockTask<string>(async (onProgress) => {
        onProgress(50, 'Halfway');
        onProgress(100, 'Done');
        return 'result';
      });

      const result = await taskManager.runTask(task);
      
      expect(result).toBe('result');
    });

    it('should track task progress', async () => {
      const progressUpdates: { progress: number; message: string }[] = [];
      
      taskManager.on('taskProgress', (taskProgress: TaskProgress) => {
        progressUpdates.push({
          progress: taskProgress.progress,
          message: taskProgress.message,
        });
      });

      // Use delays between progress calls to work with the 250ms throttle
      const task = createMockTask(async (onProgress) => {
        onProgress(25, 'Step 1');
        await new Promise(r => setTimeout(r, 260));
        onProgress(50, 'Step 2');
        await new Promise(r => setTimeout(r, 260));
        onProgress(75, 'Step 3');
        await new Promise(r => setTimeout(r, 260));
        onProgress(100, 'Complete');
      });

      await taskManager.runTask(task);
      
      expect(progressUpdates.length).toBe(4);
      expect(progressUpdates[0]).toEqual({ progress: 25, message: 'Step 1' });
      expect(progressUpdates[3]).toEqual({ progress: 100, message: 'Complete' });
    });

    it('should emit taskCreated event when task starts', async () => {
      const createdHandler = vi.fn();
      taskManager.on('taskCreated', createdHandler);

      const task = createMockTask();
      await taskManager.runTask(task);

      // The handler is called at some point during task lifecycle
      expect(createdHandler).toHaveBeenCalled();
      expect(createdHandler.mock.calls[0][0].taskId).toBe(task.id);
    });

    it('should emit taskStarted event when task begins execution', async () => {
      const startedHandler = vi.fn();
      taskManager.on('taskStarted', startedHandler);

      const task = createMockTask();
      await taskManager.runTask(task);

      // The handler is called at some point during task lifecycle
      expect(startedHandler).toHaveBeenCalled();
      expect(startedHandler.mock.calls[0][0].taskId).toBe(task.id);
    });

    it('should emit taskCompleted event when task finishes', async () => {
      const completedHandler = vi.fn();
      taskManager.on('taskCompleted', completedHandler);

      const task = createMockTask();
      await taskManager.runTask(task);

      expect(completedHandler).toHaveBeenCalledTimes(1);
      expect(completedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: task.id,
          status: 'completed',
          progress: 100,
        })
      );
    });

    it('should set endTime when task completes', async () => {
      const task = createMockTask();
      await taskManager.runTask(task);

      const status = taskManager.getTaskStatus(task.id);
      expect(status?.endTime).toBeInstanceOf(Date);
    });
  });

  describe('Task Failure', () => {
    it('should handle task failure gracefully', async () => {
      const task = createMockFailingTask('Test error');

      await expect(taskManager.runTask(task)).rejects.toThrow('Test error');
    });

    it('should emit taskFailed event on error', async () => {
      const failedHandler = vi.fn();
      taskManager.on('taskFailed', failedHandler);

      const task = createMockFailingTask('Something went wrong');

      try {
        await taskManager.runTask(task);
      } catch {
        // Expected
      }

      expect(failedHandler).toHaveBeenCalledTimes(1);
      expect(failedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: task.id,
          status: 'failed',
          error: 'Something went wrong',
        })
      );
    });

    it('should set task status to failed on error', async () => {
      const task = createMockFailingTask();

      try {
        await taskManager.runTask(task);
      } catch {
        // Expected
      }

      const status = taskManager.getTaskStatus(task.id);
      expect(status?.status).toBe('failed');
    });
  });

  describe('Task Status Queries', () => {
    it('should return task status by id', async () => {
      const task = createMockTask();
      
      // Before running
      expect(taskManager.getTaskStatus(task.id)).toBeUndefined();
      
      await taskManager.runTask(task);
      
      // After running
      const status = taskManager.getTaskStatus(task.id);
      expect(status).toBeDefined();
      expect(status?.taskId).toBe(task.id);
    });

    it('should return all tasks', async () => {
      const task1 = createMockTask();
      const task2 = createMockTask();

      await Promise.all([
        taskManager.runTask(task1),
        taskManager.runTask(task2),
      ]);

      const allTasks = taskManager.getAllTasks();
      expect(allTasks.length).toBe(2);
    });

    it('should return only running tasks', async () => {
      // Create a slow task that will still be running
      let resolveTask: () => void;
      const slowTask = createMockTask(async (onProgress) => {
        onProgress(10, 'Working...');
        await new Promise<void>(resolve => {
          resolveTask = resolve;
        });
      });

      const fastTask = createMockTask();

      // Start slow task (don't await)
      const slowPromise = taskManager.runTask(slowTask);
      
      // Run fast task
      await taskManager.runTask(fastTask);

      const runningTasks = taskManager.getRunningTasks();
      expect(runningTasks.length).toBe(1);
      expect(runningTasks[0].taskId).toBe(slowTask.id);

      // Cleanup
      resolveTask!();
      await slowPromise;
    });
  });

  describe('Task Cancellation', () => {
    it('should cancel a running task that checks for abort', async () => {
      // Task that polls for cancellation via onProgress check
      const task = createMockTask(async (onProgress) => {
        for (let i = 0; i < 20; i++) {
          // onProgress will throw if task was cancelled
          onProgress(i * 5, `Step ${i}`);
          await new Promise(resolve => setTimeout(resolve, 5));
        }
      });

      const taskPromise = taskManager.runTask(task);
      
      // Give task time to start and make some progress
      await new Promise(resolve => setTimeout(resolve, 20));
      
      const cancelled = taskManager.cancelTask(task.id);
      expect(cancelled).toBe(true);

      // The task should throw 'Task cancelled' error
      await expect(taskPromise).rejects.toThrow('Task cancelled');
    });

    it('should return false when cancelling non-existent task', () => {
      const cancelled = taskManager.cancelTask('non-existent-id');
      expect(cancelled).toBe(false);
    });

    it('should set task status to cancelled after cancel', async () => {
      // Task that polls for cancellation
      const task = createMockTask(async (onProgress) => {
        for (let i = 0; i < 20; i++) {
          onProgress(i * 5, `Step ${i}`);
          await new Promise(resolve => setTimeout(resolve, 5));
        }
      });

      const taskPromise = taskManager.runTask(task);
      
      await new Promise(resolve => setTimeout(resolve, 20));
      
      taskManager.cancelTask(task.id);

      try {
        await taskPromise;
      } catch {
        // Expected
      }

      const status = taskManager.getTaskStatus(task.id);
      expect(status?.status).toBe('cancelled');
    });
  });

  describe('Clear Completed Tasks', () => {
    it('should remove completed tasks', async () => {
      const task = createMockTask();
      await taskManager.runTask(task);

      expect(taskManager.getAllTasks().length).toBe(1);
      
      taskManager.clearCompletedTasks();
      
      expect(taskManager.getAllTasks().length).toBe(0);
    });

    it('should remove failed tasks', async () => {
      const task = createMockFailingTask();
      
      try {
        await taskManager.runTask(task);
      } catch {
        // Expected
      }

      expect(taskManager.getAllTasks().length).toBe(1);
      
      taskManager.clearCompletedTasks();
      
      expect(taskManager.getAllTasks().length).toBe(0);
    });

    it('should emit tasksCleared event', async () => {
      const clearedHandler = vi.fn();
      taskManager.on('tasksCleared', clearedHandler);

      const task = createMockTask();
      await taskManager.runTask(task);
      
      taskManager.clearCompletedTasks();
      
      expect(clearedHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Task Return Values', () => {
    it('should return typed results from tasks', async () => {
      interface TaskResult {
        count: number;
        items: string[];
      }

      const task = createMockTask<TaskResult>(async () => ({
        count: 3,
        items: ['a', 'b', 'c'],
      }));

      const result = await taskManager.runTask(task);
      
      expect(result.count).toBe(3);
      expect(result.items).toEqual(['a', 'b', 'c']);
    });

    it('should handle void tasks', async () => {
      const task = createMockTask<void>(async () => {
        // No return
      });

      const result = await taskManager.runTask(task);
      
      expect(result).toBeUndefined();
    });
  });
});

describe('TaskManager External Tasks', () => {
  let taskManager: TaskManager;

  beforeEach(() => {
    taskManager = new TaskManager();
    resetMockCounters();
  });

  it('should create an external task in running state', () => {
    taskManager.startExternalTask('ext-1', 'Language detection');

    const status = taskManager.getTaskStatus('ext-1');
    expect(status).toBeDefined();
    expect(status?.status).toBe('running');
    expect(status?.name).toBe('Language detection');
    expect(status?.progress).toBe(0);
  });

  it('should emit taskCreated and taskStarted for external tasks', () => {
    const createdHandler = vi.fn();
    const startedHandler = vi.fn();
    taskManager.on('taskCreated', createdHandler);
    taskManager.on('taskStarted', startedHandler);

    taskManager.startExternalTask('ext-2', 'Script run');

    expect(createdHandler).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'ext-2', status: 'running' }));
    expect(startedHandler).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'ext-2', status: 'running' }));
  });

  it('should update progress on an external task', () => {
    const progressHandler = vi.fn();
    taskManager.on('taskProgress', progressHandler);

    taskManager.startExternalTask('ext-3', 'Detect languages');
    taskManager.updateExternalTaskProgress('ext-3', 50, 'Halfway done');

    const status = taskManager.getTaskStatus('ext-3');
    expect(status?.progress).toBe(50);
    expect(status?.message).toBe('Halfway done');
    expect(progressHandler).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'ext-3',
      progress: 50,
      message: 'Halfway done',
    }));
  });

  it('should complete an external task', () => {
    const completedHandler = vi.fn();
    taskManager.on('taskCompleted', completedHandler);

    taskManager.startExternalTask('ext-4', 'Run utility');
    taskManager.completeExternalTask('ext-4');

    const status = taskManager.getTaskStatus('ext-4');
    expect(status?.status).toBe('completed');
    expect(status?.progress).toBe(100);
    expect(status?.endTime).toBeInstanceOf(Date);
    expect(completedHandler).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'ext-4', status: 'completed' }));
  });

  it('should fail an external task', () => {
    const failedHandler = vi.fn();
    taskManager.on('taskFailed', failedHandler);

    taskManager.startExternalTask('ext-5', 'Run utility');
    taskManager.failExternalTask('ext-5', 'Script crashed');

    const status = taskManager.getTaskStatus('ext-5');
    expect(status?.status).toBe('failed');
    expect(status?.error).toBe('Script crashed');
    expect(status?.endTime).toBeInstanceOf(Date);
    expect(failedHandler).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'ext-5', status: 'failed' }));
  });

  it('should ignore updates to non-existent external tasks', () => {
    // These should not throw
    taskManager.updateExternalTaskProgress('nope', 50, 'test');
    taskManager.completeExternalTask('nope');
    taskManager.failExternalTask('nope', 'error');
  });

  it('should include external tasks in getAllTasks and getRunningTasks', () => {
    taskManager.startExternalTask('ext-6', 'Running script');

    expect(taskManager.getAllTasks()).toHaveLength(1);
    expect(taskManager.getRunningTasks()).toHaveLength(1);

    taskManager.completeExternalTask('ext-6');

    expect(taskManager.getAllTasks()).toHaveLength(1);
    expect(taskManager.getRunningTasks()).toHaveLength(0);
  });

  it('should allow cancellation of external tasks', () => {
    taskManager.startExternalTask('ext-7', 'Long script');

    const cancelled = taskManager.cancelTask('ext-7');
    expect(cancelled).toBe(true);

    const status = taskManager.getTaskStatus('ext-7');
    expect(status?.status).toBe('cancelled');
  });

  it('should be clearable like regular tasks', () => {
    taskManager.startExternalTask('ext-8', 'Script');
    taskManager.completeExternalTask('ext-8');

    expect(taskManager.getAllTasks()).toHaveLength(1);
    taskManager.clearCompletedTasks();
    expect(taskManager.getAllTasks()).toHaveLength(0);
  });
});

describe('TaskManager Concurrency', () => {
  let taskManager: TaskManager;
  const MAX_CONCURRENT = 3;

  beforeEach(() => {
    taskManager = new TaskManager();
    resetMockCounters();
  });

  it('should run tasks up to concurrency limit', async () => {
    // Create fast tasks that complete quickly
    const tasks = Array.from({ length: 5 }, () => 
      createMockTask(async (onProgress) => {
        onProgress(50, 'Working');
        await new Promise(resolve => setTimeout(resolve, 10));
      })
    );

    // Start all tasks 
    const promises = tasks.map(t => taskManager.runTask(t));

    // Since max concurrent is 3, we should never exceed that
    // The first 3 will start immediately, others will queue
    const runningCount = taskManager.getRunningTasks().length;
    expect(runningCount).toBeLessThanOrEqual(MAX_CONCURRENT);

    // Wait for all to complete
    await Promise.all(promises);
    
    // All should be completed now
    expect(taskManager.getAllTasks().every(t => t.status === 'completed')).toBe(true);
  });
});
