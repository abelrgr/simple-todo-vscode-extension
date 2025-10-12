type TaskPriority = "high" | "medium" | "low";
type TaskStatus = "todo" | "completed";

type Task = {
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
};

type TaskFilters = {
  searchText?: string;
  priorities?: TaskPriority[];
  statuses?: TaskStatus[];
  tags?: string[];
};

type WebviewState = {
  tasks: Task[];
  filters: TaskFilters;
  availableTags: string[];
  filtersCollapsed?: boolean;
};

type VsCodeApi = {
  postMessage: (message: unknown) => void;
  setState: (newState: unknown) => void;
  getState: <T>() => T | undefined;
};

declare const acquireVsCodeApi: () => VsCodeApi;

const vscode = acquireVsCodeApi();

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

let state: WebviewState = {
  tasks: [],
  filters: {
    searchText: "",
    priorities: ["high", "medium", "low"],
    statuses: ["todo", "completed"],
    tags: [],
  },
  availableTags: [],
  filtersCollapsed: false,
};

const previousState = vscode.getState<WebviewState>();
if (previousState) {
  state = { ...state, ...previousState };
}

const appElement = document.getElementById("app") as HTMLElement;

let lastFocusedElementId: string | null = null;
let lastSelectionRange: { start: number; end: number } | null = null;
let shouldRestoreFocus = false;

function isFocusableElement(
  element: Element | null
): element is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  );
}

function captureFocusFromElement(element: Element | null) {
  if (!isFocusableElement(element) || !element.id) {
    return;
  }

  lastFocusedElementId = element.id;
  if (
    "selectionStart" in element &&
    typeof element.selectionStart === "number" &&
    typeof element.selectionEnd === "number"
  ) {
    const start = element.selectionStart ?? element.value.length;
    const end = element.selectionEnd ?? element.value.length;
    lastSelectionRange = { start, end };
  } else {
    lastSelectionRange = null;
  }
}

function preserveActiveElement() {
  shouldRestoreFocus = false;
  const active = document.activeElement;
  if (!active || !appElement.contains(active)) {
    return;
  }

  captureFocusFromElement(active);
  shouldRestoreFocus = true;
}

function restoreFocusIfNeeded() {
  if (!shouldRestoreFocus || !lastFocusedElementId) {
    return;
  }

  const element = document.getElementById(lastFocusedElementId);
  if (!isFocusableElement(element)) {
    shouldRestoreFocus = false;
    return;
  }

  element.focus({ preventScroll: true });

  if (
    "setSelectionRange" in element &&
    typeof element.setSelectionRange === "function"
  ) {
    const selection = lastSelectionRange ?? {
      start: element.value.length,
      end: element.value.length,
    };
    try {
      element.setSelectionRange(selection.start, selection.end);
    } catch {
      // Some input types (e.g. date) do not support selection; ignore safely.
    }
  }

  shouldRestoreFocus = false;
}

function updateState(partial: Partial<WebviewState>) {
  preserveActiveElement();
  state = { ...state, ...partial };
  vscode.setState(state);
  render();
}

function postMessage(message: unknown) {
  vscode.postMessage(message);
}

function render() {
  const { filters } = state;
  const filtersCollapsed = state.filtersCollapsed ?? false;
  const todoGroups = getTodoGroups();
  const completedTasks = getCompletedTasks();

  appElement.innerHTML = `
    <div class="container">
      <header class="header">
        <div class="search-container">
          <input id="search-input" type="search" placeholder="Search tasks" value="${filters.searchText ?? ""}" />
        </div>
        <div class="header-actions">
          <button id="add-task-btn" class="primary">Add task</button>
          <button id="import-btn">Import</button>
          <button id="export-btn">Export</button>
        </div>
      </header>
      <section class="filters ${filtersCollapsed ? "collapsed" : ""}">
        <div class="filters-header">
          <h2>Filters</h2>
          <button
            id="toggle-filters-btn"
            class="filters-toggle"
            aria-expanded="${filtersCollapsed ? "false" : "true"}"
            aria-controls="filters-body"
            data-collapsed="${filtersCollapsed ? "true" : "false"}"
          >${filtersCollapsed ? "Show filters" : "Hide filters"}</button>
        </div>
        <div id="filters-body" class="filters-body">
          <div class="filter-group">
            <span>Status:</span>
            ${renderCheckbox("status-todo", "Todo", filters.statuses?.includes("todo") ?? false)}
            ${renderCheckbox("status-completed", "Completed", filters.statuses?.includes("completed") ?? false)}
          </div>
          <div class="filter-group">
            <span>Priority:</span>
            ${(["high", "medium", "low"] as TaskPriority[])
              .map((priority) =>
                renderCheckbox(
                  `priority-${priority}`,
                  PRIORITY_LABELS[priority],
                  filters.priorities?.includes(priority) ?? false,
                  priority
                )
              )
              .join("")}
          </div>
          <div class="filter-group tags-filter">
            <span>Tags:</span>
            <select id="tag-filter" multiple>
              ${state.availableTags
                .map(
                  (tag) =>
                    `<option value="${tag}" ${filters.tags?.includes(tag) ? "selected" : ""}>${tag}</option>`
                )
                .join("")}
            </select>
          </div>
          <div class="filter-actions">
            <button id="reset-filters-btn" title="Reset filters">Reset filters</button>
          </div>
        </div>
      </section>
      <main class="board">
        <section class="column">
          <div class="column-header">
            <h2>Todo</h2>
            <span class="count">${todoGroups.reduce<number>((count, list) => count + list.tasks.length, 0)}</span>
          </div>
          <div class="priority-grid">
            ${renderPriorityColumn(
              "high",
              todoGroups.find(
                (entry: { priority: TaskPriority; tasks: Task[] }) =>
                  entry.priority === "high"
              )?.tasks ?? []
            )}
            ${renderPriorityColumn(
              "medium",
              todoGroups.find(
                (entry: { priority: TaskPriority; tasks: Task[] }) =>
                  entry.priority === "medium"
              )?.tasks ?? []
            )}
            ${renderPriorityColumn(
              "low",
              todoGroups.find(
                (entry: { priority: TaskPriority; tasks: Task[] }) =>
                  entry.priority === "low"
              )?.tasks ?? []
            )}
          </div>
        </section>
        <section class="column">
          <div class="column-header">
            <div class="column-title">
              <h2>Completed</h2>
              <span class="count">${completedTasks.length}</span>
            </div>
            <button id="clear-completed-btn" title="Remove all completed tasks" ${
              completedTasks.length ? "" : "disabled"
            }>Clear completed</button>
          </div>
          <div class="task-list completed" data-status="completed">
            ${completedTasks.map(renderTaskCard).join("") || emptyState("No completed tasks yet.")}
          </div>
        </section>
      </main>
    </div>
    ${renderModal()}
  `;

  bindInteractions();
  requestAnimationFrame(() => restoreFocusIfNeeded());
}

function renderCheckbox(
  id: string,
  label: string,
  checked: boolean,
  value?: string
) {
  return `
    <label class="checkbox">
      <input type="checkbox" id="${id}" value="${value ?? ""}" ${checked ? "checked" : ""} />
      <span>${label}</span>
    </label>
  `;
}

function renderPriorityColumn(priority: TaskPriority, tasks: Task[]) {
  return `
    <div class="priority-column" data-priority="${priority}">
      <div class="priority-header">
        <h3>${PRIORITY_LABELS[priority]}</h3>
        <span class="count">${tasks.length}</span>
      </div>
      <div class="task-list" data-status="todo" data-priority="${priority}">
        ${tasks.map(renderTaskCard).join("") || emptyState("Drop tasks here")}
      </div>
    </div>
  `;
}

function renderTaskCard(task: Task) {
  const dueDate = parseDateOnly(task.dueDate);
  const isOverdue = isTaskOverdue(task);
  const dueDateLabel = dueDate ? dueDate.toLocaleDateString() : "";
  const tags = task.tags
    .map((tag) => `<span class="tag">${tag}</span>`)
    .join("");
  const statusClass = task.status === "completed" ? "completed" : "";
  const priorityClass = `priority-${task.priority}`;
  const overdueClass = isOverdue ? "overdue" : "";
  return `
    <article class="task-card ${statusClass} ${priorityClass} ${overdueClass}" draggable="true" data-task-id="${task.id}">
      <header>
        <label class="checkbox">
          <input type="checkbox" class="toggle-status" data-task-id="${task.id}" ${
            task.status === "completed" ? "checked" : ""
          } />
          <span class="title">${escapeHtml(task.title)}</span>
        </label>
        <div class="actions">
          <button class="icon-btn edit" data-task-id="${task.id}" title="Edit task">✏️</button>
          <button class="icon-btn delete" data-task-id="${task.id}" title="Delete task">🗑️</button>
        </div>
      </header>
      ${task.description ? `<p class="description">${escapeHtml(task.description)}</p>` : ""}
      <footer>
        <span class="chip priority">${PRIORITY_LABELS[task.priority]}</span>
        ${
          dueDateLabel
            ? `<span class="chip due-date ${isOverdue ? "overdue" : ""}">${
                isOverdue ? "Overdue" : "Due"
              } ${dueDateLabel}</span>`
            : ""
        }
        <div class="tags">${tags}</div>
      </footer>
    </article>
  `;
}

function renderModal() {
  return `
    <div id="task-modal" class="modal hidden" role="dialog" aria-modal="true">
      <div class="modal-content">
        <header>
          <h2 id="modal-title">Add task</h2>
          <button id="close-modal" class="icon-btn" aria-label="Close">✕</button>
        </header>
        <form id="task-form">
          <input type="hidden" name="taskId" />
          <div class="field">
            <label for="task-title">Title</label>
            <input id="task-title" name="title" type="text" required maxlength="120" />
          </div>
          <div class="field">
            <label for="task-description">Description</label>
            <textarea id="task-description" name="description" rows="3" maxlength="500"></textarea>
          </div>
          <div class="grid">
            <div class="field">
              <label for="task-priority">Priority</label>
              <select id="task-priority" name="priority">
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div class="field">
              <label for="task-due-date">Due date</label>
              <input id="task-due-date" name="dueDate" type="date" />
            </div>
          </div>
          <div class="field">
            <label for="task-tags">Tags (comma separated)</label>
            <input id="task-tags" name="tags" type="text" placeholder="productivity, planning" />
          </div>
          <div class="actions">
            <button type="button" id="cancel-modal">Cancel</button>
            <button type="submit" class="primary" id="submit-task">Save task</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function emptyState(message: string) {
  return `<p class="empty">${message}</p>`;
}

function bindInteractions() {
  const searchInput = document.getElementById(
    "search-input"
  ) as HTMLInputElement;
  searchInput?.addEventListener("input", (event) => {
    const value = (event.target as HTMLInputElement).value;
    const filters = { ...state.filters, searchText: value };
    updateFilters(filters);
  });

  const toggleFiltersBtn = document.getElementById(
    "toggle-filters-btn"
  ) as HTMLButtonElement | null;
  toggleFiltersBtn?.addEventListener("click", () => {
    const nextCollapsed = !(state.filtersCollapsed ?? false);
    updateState({ filtersCollapsed: nextCollapsed });
  });

  document
    .getElementById("add-task-btn")
    ?.addEventListener("click", () => openModal());
  document
    .getElementById("import-btn")
    ?.addEventListener("click", () => postMessage({ type: "requestImport" }));
  document
    .getElementById("export-btn")
    ?.addEventListener("click", () => postMessage({ type: "requestExport" }));

  const statusTodo = document.getElementById("status-todo") as HTMLInputElement;
  const statusCompleted = document.getElementById(
    "status-completed"
  ) as HTMLInputElement;
  statusTodo?.addEventListener("change", () =>
    toggleStatusFilter("todo", statusTodo.checked)
  );
  statusCompleted?.addEventListener("change", () =>
    toggleStatusFilter("completed", statusCompleted.checked)
  );

  (["high", "medium", "low"] as TaskPriority[]).forEach((priority) => {
    const checkbox = document.getElementById(
      `priority-${priority}`
    ) as HTMLInputElement;
    checkbox?.addEventListener("change", () =>
      togglePriorityFilter(priority, checkbox.checked)
    );
  });

  const tagFilter = document.getElementById("tag-filter") as HTMLSelectElement;
  tagFilter?.addEventListener("change", () => {
    const selected = Array.from(tagFilter.selectedOptions).map(
      (option) => option.value
    );
    const filters = { ...state.filters, tags: selected };
    updateFilters(filters);
  });

  document
    .getElementById("reset-filters-btn")
    ?.addEventListener("click", () => {
      resetFilters();
      const searchInputEl = document.getElementById(
        "search-input"
      ) as HTMLInputElement | null;
      searchInputEl?.focus({ preventScroll: true });
    });

  const clearCompletedBtn = document.getElementById(
    "clear-completed-btn"
  ) as HTMLButtonElement | null;
  clearCompletedBtn?.addEventListener("click", () => {
    if (clearCompletedBtn.disabled) {
      return;
    }
    postMessage({ type: "clearCompleted" });
  });

  document.querySelectorAll<HTMLElement>(".task-card").forEach((card) => {
    card.addEventListener("dragstart", (event) =>
      handleDragStart(event as DragEvent)
    );
    card.addEventListener("dragend", (event) =>
      handleDragEnd(event as DragEvent)
    );
  });

  document.querySelectorAll<HTMLElement>(".task-list").forEach((list) => {
    list.addEventListener("dragover", (event) =>
      handleDragOver(event as DragEvent)
    );
    list.addEventListener("drop", (event) => handleDrop(event as DragEvent));
    list.addEventListener("dragleave", () =>
      list.classList.remove("drag-over")
    );
  });

  document.querySelectorAll(".toggle-status").forEach((checkbox) =>
    checkbox.addEventListener("change", (event) => {
      const element = event.target as HTMLInputElement;
      const taskId = element.dataset.taskId;
      if (!taskId) {
        return;
      }
      postMessage({
        type: "toggleTask",
        payload: { id: taskId, status: element.checked ? "completed" : "todo" },
      });
    })
  );

  document.querySelectorAll(".icon-btn.edit").forEach((button) =>
    button.addEventListener("click", (event) => {
      const taskId = (event.currentTarget as HTMLButtonElement).dataset.taskId;
      if (!taskId) {
        return;
      }
      const task = state.tasks.find((item) => item.id === taskId);
      if (!task) {
        return;
      }
      openModal(task);
    })
  );

  document.querySelectorAll(".icon-btn.delete").forEach((button) =>
    button.addEventListener("click", (event) => {
      const taskId = (event.currentTarget as HTMLButtonElement).dataset.taskId;
      if (!taskId) {
        return;
      }
      postMessage({ type: "deleteTask", payload: { id: taskId } });
    })
  );

  const modal = document.getElementById("task-modal") as HTMLElement;
  const closeBtn = document.getElementById("close-modal");
  const cancelBtn = document.getElementById("cancel-modal");
  closeBtn?.addEventListener("click", () => closeModal());
  cancelBtn?.addEventListener("click", () => closeModal());

  modal?.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });

  const form = document.getElementById("task-form") as HTMLFormElement;
  if (form) {
    const titleInput = form.elements.namedItem("title") as HTMLInputElement;
    const submitBtn = document.getElementById(
      "submit-task"
    ) as HTMLButtonElement;

    const updateSubmitState = () => {
      submitBtn.disabled = titleInput.value.trim().length === 0;
    };

    updateSubmitState();

    titleInput?.addEventListener("input", () => {
      updateSubmitState();
    });

    form.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey) {
        return;
      }
      const target = event.target as HTMLElement;
      if (target instanceof HTMLTextAreaElement) {
        return;
      }
      event.preventDefault();
      submitTaskForm(form);
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submitTaskForm(form);
    });
  }
}

function parseDateOnly(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }
  const segments = value.split("-").map((part) => Number.parseInt(part, 10));
  if (
    segments.length !== 3 ||
    segments.some((segment) => Number.isNaN(segment))
  ) {
    return undefined;
  }
  const [year, month, day] = segments;
  return new Date(year, month - 1, day);
}

function isTaskOverdue(task: Task): boolean {
  if (task.status === "completed") {
    return false;
  }
  const due = parseDateOnly(task.dueDate);
  if (!due) {
    return false;
  }
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return due.getTime() < today.getTime();
}

function parseTags(raw: string | null): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function submitTaskForm(form: HTMLFormElement) {
  const data = new FormData(form);
  const title = (data.get("title") as string | null)?.trim();
  if (!title) {
    return;
  }

  const payload = {
    title,
    description:
      (data.get("description") as string | null)?.trim() || undefined,
    priority: (data.get("priority") as TaskPriority) ?? "medium",
    dueDate: (data.get("dueDate") as string | null) || undefined,
    tags: parseTags((data.get("tags") as string | null) ?? null),
  };

  const taskId = (data.get("taskId") as string | null) ?? "";
  if (taskId) {
    postMessage({
      type: "updateTask",
      payload: { id: taskId, updates: payload },
    });
  } else {
    postMessage({ type: "createTask", payload });
  }

  closeModal();
}

function toggleStatusFilter(status: TaskStatus, enabled: boolean) {
  const statuses = new Set(state.filters.statuses ?? []);
  if (enabled) {
    statuses.add(status);
  } else {
    statuses.delete(status);
  }
  const updated = { ...state.filters, statuses: Array.from(statuses) };
  updateFilters(updated);
}

function togglePriorityFilter(priority: TaskPriority, enabled: boolean) {
  const priorities = new Set(state.filters.priorities ?? []);
  if (enabled) {
    priorities.add(priority);
  } else {
    priorities.delete(priority);
  }
  const updated = { ...state.filters, priorities: Array.from(priorities) };
  updateFilters(updated);
}

function updateFilters(filters: TaskFilters) {
  postMessage({ type: "filtersChanged", payload: filters });
  updateState({ filters });
}

function resetFilters() {
  const defaults: TaskFilters = {
    searchText: "",
    priorities: ["high", "medium", "low"],
    statuses: ["todo", "completed"],
    tags: [],
  };
  updateFilters(defaults);
}

function getTodoGroups(): Array<{ priority: TaskPriority; tasks: Task[] }> {
  const { filters, tasks } = state;
  const allowedStatuses = filters.statuses?.length
    ? filters.statuses
    : ["todo", "completed"];
  const allowedPriorities = filters.priorities?.length
    ? filters.priorities
    : ["high", "medium", "low"];
  const needles = (filters.searchText ?? "").toLowerCase();
  const tagFilters = filters.tags ?? [];

  const filtered = tasks.filter((task) => {
    if (task.status !== "todo") {
      return false;
    }
    if (!allowedStatuses.includes("todo")) {
      return false;
    }
    if (!allowedPriorities.includes(task.priority)) {
      return false;
    }
    if (needles) {
      const haystack = [task.title, task.description ?? "", task.tags.join(" ")]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(needles)) {
        return false;
      }
    }
    if (
      tagFilters.length &&
      !tagFilters.every((tag) => task.tags.includes(tag))
    ) {
      return false;
    }
    return true;
  });

  const grouped = new Map<TaskPriority, Task[]>();
  filtered
    .sort((a, b) => {
      if (a.priority === b.priority) {
        return a.order - b.order;
      }
      return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    })
    .forEach((task) => {
      const collection = grouped.get(task.priority) ?? [];
      collection.push(task);
      grouped.set(task.priority, collection);
    });

  return ["high", "medium", "low"].map((priority) => ({
    priority: priority as TaskPriority,
    tasks: grouped.get(priority as TaskPriority) ?? [],
  }));
}

function getCompletedTasks(): Task[] {
  const { filters, tasks } = state;
  const allowedStatuses = filters.statuses?.length
    ? filters.statuses
    : ["todo", "completed"];
  const needles = (filters.searchText ?? "").toLowerCase();
  const tagFilters = filters.tags ?? [];

  return tasks
    .filter((task) => {
      if (task.status !== "completed") {
        return false;
      }
      if (!allowedStatuses.includes("completed")) {
        return false;
      }
      if (needles) {
        const haystack = [
          task.title,
          task.description ?? "",
          task.tags.join(" "),
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(needles)) {
          return false;
        }
      }
      if (
        tagFilters.length &&
        !tagFilters.every((tag) => task.tags.includes(tag))
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (a.completedAt && b.completedAt) {
        return (
          new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
        );
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
}

function handleDragStart(event: DragEvent) {
  const card = event.currentTarget as HTMLElement;
  card.classList.add("dragging");
  event.dataTransfer?.setData("text/plain", card.dataset.taskId ?? "");
  event.dataTransfer?.setDragImage(card, 10, 10);
}

function handleDragEnd(event: DragEvent) {
  const card = event.currentTarget as HTMLElement;
  card.classList.remove("dragging");
}

function handleDragOver(event: DragEvent) {
  event.preventDefault();
  const target = event.currentTarget as HTMLElement;
  target.classList.add("drag-over");
}

function handleDrop(event: DragEvent) {
  event.preventDefault();
  const list = event.currentTarget as HTMLElement;
  list.classList.remove("drag-over");
  const taskId = event.dataTransfer?.getData("text/plain");
  if (!taskId) {
    return;
  }

  const currentTask = state.tasks.find((item) => item.id === taskId);
  const priority =
    (list.dataset.priority as TaskPriority) ??
    currentTask?.priority ??
    "medium";
  const status = (list.dataset.status as TaskStatus) ?? "todo";
  const order = calculateDropOrder(list, event, taskId);
  postMessage({
    type: "reorderTask",
    payload: { id: taskId, priority, order, status },
  });
}

function calculateDropOrder(
  list: HTMLElement,
  event: DragEvent,
  taskId: string
): number {
  const cards = Array.from(list.querySelectorAll<HTMLElement>(".task-card"));
  if (!cards.length) {
    return 0;
  }

  const mouseY = event.clientY;
  let closestIndex = cards.length;

  cards.forEach((card, index) => {
    const rect = card.getBoundingClientRect();
    const offset = mouseY - rect.top - rect.height / 2;
    if (offset < 0 && index < closestIndex && card.dataset.taskId !== taskId) {
      closestIndex = index;
    }
  });

  return closestIndex;
}

function openModal(task?: Task) {
  const modal = document.getElementById("task-modal");
  if (!modal) {
    return;
  }
  modal.classList.remove("hidden");
  setTimeout(() => modal.classList.add("visible"), 10);

  const form = document.getElementById("task-form") as HTMLFormElement;
  (form.elements.namedItem("taskId") as HTMLInputElement).value =
    task?.id ?? "";
  (form.elements.namedItem("title") as HTMLInputElement).value =
    task?.title ?? "";
  (form.elements.namedItem("description") as HTMLTextAreaElement).value =
    task?.description ?? "";
  (form.elements.namedItem("priority") as HTMLSelectElement).value =
    task?.priority ?? "medium";
  (form.elements.namedItem("dueDate") as HTMLInputElement).value =
    task?.dueDate ?? "";
  (form.elements.namedItem("tags") as HTMLInputElement).value =
    task?.tags.join(", ") ?? "";

  const modalTitle = document.getElementById("modal-title") as HTMLElement;
  const submitBtn = document.getElementById("submit-task") as HTMLButtonElement;
  if (task) {
    modalTitle.textContent = "Edit task";
    submitBtn.textContent = "Update task";
  } else {
    modalTitle.textContent = "Add task";
    submitBtn.textContent = "Save task";
  }

  submitBtn.disabled = (task?.title?.trim().length ?? 0) === 0;

  requestAnimationFrame(() => {
    const titleInput = document.getElementById(
      "task-title"
    ) as HTMLInputElement | null;
    titleInput?.focus({ preventScroll: true });
    if (titleInput) {
      const length = titleInput.value.length;
      try {
        titleInput.setSelectionRange(length, length);
      } catch {
        /* Ignore selection errors */
      }
    }
  });
}

function closeModal() {
  const modal = document.getElementById("task-modal");
  if (!modal) {
    return;
  }
  modal.classList.remove("visible");
  setTimeout(() => modal.classList.add("hidden"), 150);
}

function escapeHtml(value: string) {
  const div = document.createElement("div");
  div.innerText = value;
  return div.innerHTML;
}

window.addEventListener("message", (event) => {
  const message = event.data as { type: string; payload?: WebviewState };
  switch (message.type) {
    case "initialState":
    case "tasksUpdated":
      if (message.payload) {
        updateState(message.payload);
      }
      break;
    case "focusCreateForm":
      openModal();
      break;
    case "notification":
      if (message.payload && "message" in message.payload) {
        showToast((message.payload as any).message);
      }
      break;
    default:
      break;
  }
});

document.addEventListener("focusin", (event) => {
  if (!appElement.contains(event.target as Node)) {
    return;
  }
  captureFocusFromElement(event.target as Element);
});

function showToast(message: string) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add("visible"), 10);
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 300);
  }, 2400);
}

postMessage({ type: "ready" });
render();
