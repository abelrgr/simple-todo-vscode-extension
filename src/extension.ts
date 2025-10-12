import * as vscode from "vscode";
import * as path from "path";
import { TextDecoder, TextEncoder } from "util";
import { TaskStore, CreateTaskPayload, UpdateTaskPayload } from "./taskStore";
import {
  Task,
  TaskFilters,
  TaskPriority,
  TaskStatus,
  LegacyExportBundle,
  ExportBundle,
} from "./types";

const FILTER_STORAGE_KEY = "simpleTodo.filters";

type IncomingMessage =
  | { type: "ready" }
  | { type: "createTask"; payload: CreateTaskPayload }
  | { type: "updateTask"; payload: { id: string; updates: UpdateTaskPayload } }
  | { type: "deleteTask"; payload: { id: string } }
  | { type: "toggleTask"; payload: { id: string; status: TaskStatus } }
  | {
      type: "reorderTask";
      payload: {
        id: string;
        priority: TaskPriority;
        order: number;
        status: TaskStatus;
      };
    }
  | { type: "filtersChanged"; payload: TaskFilters }
  | { type: "requestExport" }
  | { type: "requestImport" }
  | { type: "clearCompleted" }
  | { type: "notify"; payload: { message: string; type: "info" | "error" } };

type OutgoingMessage =
  | { type: "initialState"; payload: WebviewState }
  | { type: "tasksUpdated"; payload: WebviewState }
  | { type: "focusCreateForm" }
  | {
      type: "notification";
      payload: { message: string; type: "info" | "error" };
    };

interface WebviewState {
  tasks: Task[];
  filters: TaskFilters;
  availableTags: string[];
  filtersCollapsed?: boolean;
}

class TodoWebviewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private readonly disposables: vscode.Disposable[] = [];
  private filters: TaskFilters;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly taskStore: TaskStore
  ) {
    this.filters = this.context.workspaceState.get<TaskFilters>(
      FILTER_STORAGE_KEY,
      {
        statuses: ["todo", "completed"],
        priorities: ["high", "medium", "low"],
        searchText: "",
        tags: [],
      }
    );

    this.disposables.push(
      this.taskStore.onDidChange(() => {
        this.postMessage({
          type: "tasksUpdated",
          payload: this.getWebviewState(),
        });
      })
    );
  }

  dispose() {
    vscode.Disposable.from(...this.disposables).dispose();
  }

  async resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView;
    const webview = webviewView.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(this.context.extensionUri.fsPath, "media")),
      ],
    };
    webview.html = this.getHtmlContent(webview);

    webview.onDidReceiveMessage(async (message: IncomingMessage) => {
      await this.handleMessage(message);
    });

    this.postMessage({ type: "initialState", payload: this.getWebviewState() });
  }

  revealCreateForm() {
    if (this.view) {
      this.view.show?.(true);
      this.postMessage({ type: "focusCreateForm" });
    }
  }

  async triggerExport() {
    const bundle = this.taskStore.exportTasks();
    const uri = await vscode.window.showSaveDialog({
      saveLabel: "Export simple-todo-vscode-extension",
      filters: { JSON: ["json"] },
      defaultUri: vscode.Uri.file("simple-todo-vscode-extension.json"),
    });
    if (!uri) {
      return;
    }

    const encoder = new TextEncoder();
    await vscode.workspace.fs.writeFile(
      uri,
      encoder.encode(JSON.stringify(bundle, null, 2))
    );
    const pendingCount = bundle.pending.length;
    const completedCount = bundle.completed.length;
    const total = pendingCount + completedCount;
    vscode.window.showInformationMessage(
      `Exported ${total} tasks (${pendingCount} pending, ${completedCount} completed) to ${uri.fsPath}`
    );
  }

  async triggerImport() {
    const selection = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      filters: { JSON: ["json"] },
      openLabel: "Import simple-todo-vscode-extension",
    });
    if (!selection?.length) {
      return;
    }
    const uri = selection[0];
    const buffer = await vscode.workspace.fs.readFile(uri);
    const decoder = new TextDecoder("utf-8");
    try {
      const parsed = JSON.parse(decoder.decode(buffer));
      const tasks = this.normalizeImportedPayload(parsed);
      await this.taskStore.importTasks(tasks);
      const pendingCount = tasks.filter(
        (task) => task.status !== "completed"
      ).length;
      const completedCount = tasks.length - pendingCount;
      vscode.window.showInformationMessage(
        `Imported ${tasks.length} tasks (${pendingCount} pending, ${completedCount} completed) from ${uri.fsPath}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Failed to import tasks: ${message}`);
    }
  }

  // sync feature removed

  private async handleMessage(message: IncomingMessage) {
    switch (message.type) {
      case "ready":
        this.postMessage({
          type: "initialState",
          payload: this.getWebviewState(),
        });
        break;
      case "createTask":
        await this.taskStore.create(message.payload);
        break;
      case "updateTask":
        await this.taskStore.update(
          message.payload.id,
          message.payload.updates
        );
        break;
      case "deleteTask":
        await this.taskStore.remove(message.payload.id);
        break;
      case "toggleTask":
        await this.taskStore.toggle(message.payload.id, message.payload.status);
        break;
      case "reorderTask":
        await this.taskStore.reorder(
          message.payload.id,
          message.payload.priority,
          message.payload.order,
          message.payload.status
        );
        break;
      case "filtersChanged":
        this.filters = message.payload;
        await this.context.workspaceState.update(
          FILTER_STORAGE_KEY,
          this.filters
        );
        break;
      case "requestExport":
        await this.triggerExport();
        break;
      case "requestImport":
        await this.triggerImport();
        break;
      // requestSync removed
      case "clearCompleted": {
        const choice = await vscode.window.showWarningMessage(
          "Remove all completed tasks? This action cannot be undone.",
          { modal: true },
          "Remove"
        );
        if (choice !== "Remove") {
          break;
        }

        const removed = await this.taskStore.removeCompleted();
        if (removed > 0) {
          vscode.window.showInformationMessage(
            `Removed ${removed} completed task${removed === 1 ? "" : "s"}.`
          );
        } else {
          vscode.window.showInformationMessage(
            "There are no completed tasks to remove."
          );
        }
        break;
      }
      case "notify":
        this.handleNotification(message.payload.message, message.payload.type);
        break;
      default:
        break;
    }
  }

  private handleNotification(message: string, type: "info" | "error") {
    if (type === "error") {
      vscode.window.showErrorMessage(message);
    } else {
      vscode.window.showInformationMessage(message);
    }
  }

  private postMessage(message: OutgoingMessage) {
    this.view?.webview.postMessage(message);
  }

  private getWebviewState(): WebviewState {
    const tasks = this.taskStore.getAll();
    return {
      tasks,
      filters: this.filters,
      availableTags: Array.from(
        new Set(tasks.flatMap((task) => task.tags))
      ).sort((a, b) => a.localeCompare(b)),
    };
  }

  private getHtmlContent(webview: vscode.Webview): string {
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionUri.fsPath, "media", "main.js"))
    );
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionUri.fsPath, "media", "styles.css"))
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${stylesUri}">
<title>simple-todo-vscode-extension</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private normalizeImportedPayload(payload: unknown): Task[] {
    if (Array.isArray(payload)) {
      return this.sanitizeTaskArray(payload);
    }

    if (payload && typeof payload === "object") {
      const candidate = payload as Partial<ExportBundle> &
        Partial<LegacyExportBundle>;
      const hasGroupedArrays =
        Array.isArray(candidate.pending) || Array.isArray(candidate.completed);

      if (hasGroupedArrays) {
        const pending = Array.isArray(candidate.pending)
          ? this.sanitizeTaskArray(candidate.pending, "todo")
          : [];
        const completed = Array.isArray(candidate.completed)
          ? this.sanitizeTaskArray(candidate.completed, "completed")
          : [];
        return [...pending, ...completed];
      }

      if (Array.isArray(candidate.tasks)) {
        return this.sanitizeTaskArray(candidate.tasks);
      }
    }

    throw new Error(
      'Invalid file format. Expected "pending"/"completed" or "tasks" arrays.'
    );
  }

  private sanitizeTaskArray(
    tasks: unknown[],
    enforcedStatus?: TaskStatus
  ): Task[] {
    if (tasks.length === 0) {
      return [];
    }

    const validated = tasks.filter((task): task is Task =>
      this.isTaskLike(task)
    );
    if (validated.length !== tasks.length) {
      throw new Error("Invalid file format. Some tasks are malformed.");
    }

    return validated.map((task) => ({
      ...task,
      status:
        enforcedStatus ?? (task.status === "completed" ? "completed" : "todo"),
    }));
  }

  private isTaskLike(value: unknown): value is Task {
    if (!value || typeof value !== "object") {
      return false;
    }

    const candidate = value as Partial<Task>;
    return (
      typeof candidate.id === "string" &&
      typeof candidate.title === "string" &&
      typeof candidate.priority === "string" &&
      Array.isArray(candidate.tags) &&
      typeof candidate.createdAt === "string" &&
      typeof candidate.updatedAt === "string" &&
      typeof candidate.order === "number"
    );
  }
}

export async function activate(context: vscode.ExtensionContext) {
  const taskStore = new TaskStore(context.workspaceState);
  const provider = new TodoWebviewProvider(context, taskStore);

  context.subscriptions.push(
    taskStore,
    vscode.window.registerWebviewViewProvider("simpleTodoView", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("simpleTodo.addTask", () =>
      provider.revealCreateForm()
    ),
    vscode.commands.registerCommand("simpleTodo.importTasks", () =>
      provider.triggerImport()
    ),
    vscode.commands.registerCommand("simpleTodo.exportTasks", () =>
      provider.triggerExport()
    )
    // sync command removed
  );
}

export function deactivate() {}

function getNonce() {
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 32 })
    .map(() => possible.charAt(Math.floor(Math.random() * possible.length)))
    .join("");
}
