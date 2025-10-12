export type TaskPriority = "high" | "medium" | "low";
export type TaskStatus = "todo" | "completed";

export interface Task {
  id: string;
  title: string;
  description?: string;
  priority: TaskPriority;
  tags: string[];
  dueDate?: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  order: number;
}

export interface TaskFilters {
  searchText?: string;
  priorities?: TaskPriority[];
  statuses?: TaskStatus[];
  tags?: string[];
}

export interface ExportBundle {
  version: string;
  exportedAt: string;
  pending: Task[];
  completed: Task[];
}

export interface LegacyExportBundle {
  version?: string;
  exportedAt?: string;
  tasks: Task[];
}
