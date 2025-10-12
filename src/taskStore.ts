import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { Task, TaskPriority, TaskStatus, ExportBundle } from './types';

const STORAGE_KEY = 'simpleTodo.tasks';

export interface CreateTaskPayload {
  title: string;
  description?: string;
  priority: TaskPriority;
  tags?: string[];
  dueDate?: string;
}

export interface UpdateTaskPayload extends Partial<CreateTaskPayload> {
  status?: TaskStatus;
}

export class TaskStore implements vscode.Disposable {
  private readonly tasks: Task[] = [];
  private readonly changeEmitter = new vscode.EventEmitter<Task[]>();

  constructor(private readonly workspaceState: vscode.Memento) {
    const persisted = this.workspaceState.get<Task[]>(STORAGE_KEY, []);
    if (persisted && persisted.length > 0) {
      this.tasks.push(
        ...persisted.map((task: Task, index: number) => ({
          ...task,
          order: task.order ?? index,
          tags: Array.isArray(task.tags) ? task.tags : [],
          status: task.status ?? 'todo'
        }))
      );
    }
  }

  dispose() {
    this.changeEmitter.dispose();
  }

  get onDidChange() {
    return this.changeEmitter.event;
  }

  getAll(): Task[] {
    return [...this.tasks];
  }

  getById(id: string): Task | undefined {
    return this.tasks.find((task) => task.id === id);
  }

  async create(payload: CreateTaskPayload): Promise<Task> {
    const now = new Date().toISOString();
    const newTask: Task = {
  id: randomUUID(),
      title: payload.title.trim(),
      description: payload.description?.trim(),
      priority: payload.priority,
      tags: payload.tags?.map((tag) => tag.trim()).filter(Boolean) ?? [],
      dueDate: payload.dueDate,
      status: 'todo',
      createdAt: now,
      updatedAt: now,
      order: this.nextOrder(payload.priority)
    };

    this.tasks.push(newTask);
    await this.persist();
    this.emit();
    return newTask;
  }

  async update(id: string, payload: UpdateTaskPayload): Promise<Task | undefined> {
    const existing = this.getById(id);
    if (!existing) {
      return undefined;
    }

    existing.title = payload.title?.trim() ?? existing.title;
    existing.description = payload.description?.trim() ?? existing.description;
    existing.priority = payload.priority ?? existing.priority;
    existing.tags = payload.tags?.map((tag) => tag.trim()).filter(Boolean) ?? existing.tags;
    existing.dueDate = payload.dueDate ?? existing.dueDate;
    if (payload.status && payload.status !== existing.status) {
      existing.status = payload.status;
      existing.completedAt = payload.status === 'completed' ? new Date().toISOString() : undefined;
    }
    existing.updatedAt = new Date().toISOString();

    if (payload.priority && payload.priority !== existing.priority) {
      existing.order = this.nextOrder(payload.priority);
    }

    await this.persist();
    this.emit();
    return existing;
  }

  async remove(id: string): Promise<boolean> {
    const index = this.tasks.findIndex((task) => task.id === id);
    if (index === -1) {
      return false;
    }

    this.tasks.splice(index, 1);
    await this.persist();
    this.emit();
    return true;
  }

  async toggle(id: string, status: TaskStatus): Promise<Task | undefined> {
    return this.update(id, { status });
  }

  async reorder(
    id: string,
    targetPriority: TaskPriority,
    targetOrder: number,
    targetStatus: TaskStatus
  ): Promise<Task | undefined> {
    const task = this.getById(id);
    if (!task) {
      return undefined;
    }

    const previousPriority = task.priority;
    const previousStatus = task.status;

    const destination = this.tasks
      .filter((candidate) => candidate.id !== id && candidate.priority === targetPriority && candidate.status === targetStatus)
      .sort((a, b) => a.order - b.order);

    const insertionIndex = Math.min(Math.max(targetOrder, 0), destination.length);
    destination.splice(insertionIndex, 0, task);

    task.priority = targetPriority;
    task.status = targetStatus;
    task.completedAt = targetStatus === 'completed' ? new Date().toISOString() : undefined;
    task.updatedAt = new Date().toISOString();

    destination.forEach((item, index) => {
      item.order = index;
    });

    if (previousPriority !== targetPriority || previousStatus !== targetStatus) {
      const previousCollection = this.tasks
        .filter((candidate) => candidate.priority === previousPriority && candidate.status === previousStatus && candidate.id !== task.id)
        .sort((a, b) => a.order - b.order);
      previousCollection.forEach((item, index) => {
        item.order = index;
      });
    }
    await this.persist();
    this.emit();
    return task;
  }

  async removeCompleted(): Promise<number> {
    const remaining = this.tasks.filter((task) => task.status !== 'completed');
    if (remaining.length === this.tasks.length) {
      return 0;
    }

    const removedCount = this.tasks.length - remaining.length;
    this.tasks.splice(0, this.tasks.length, ...remaining);
    await this.persist();
    this.emit();
    return removedCount;
  }

  async importTasks(tasks: Task[]): Promise<void> {
    const sanitized = tasks.map((task, index) => ({
      ...task,
      id: task.id ?? randomUUID(),
      order: task.order ?? index,
      tags: Array.isArray(task.tags) ? task.tags : [],
      status: (task.status === 'completed' ? 'completed' : 'todo') as TaskStatus
    }));

    this.tasks.splice(0, this.tasks.length, ...sanitized);
    await this.persist();
    this.emit();
  }

  exportTasks(): ExportBundle {
    const tasks = this.getAll();
    return {
      version: '1.1.0',
      exportedAt: new Date().toISOString(),
      pending: tasks.filter((task) => task.status !== 'completed'),
      completed: tasks.filter((task) => task.status === 'completed')
    };
  }

  private nextOrder(priority: TaskPriority): number {
    const samePriority = this.tasks
      .filter((task) => task.priority === priority && task.status === 'todo')
      .map((task) => task.order);
    if (samePriority.length === 0) {
      return 0;
    }
    return Math.max(...samePriority) + 1;
  }

  private async persist() {
    await this.workspaceState.update(STORAGE_KEY, this.tasks);
  }

  private emit() {
    this.changeEmitter.fire(this.getAll());
  }
}
