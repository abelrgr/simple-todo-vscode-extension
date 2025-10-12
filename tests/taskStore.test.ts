import assert from "assert";
import Module from "module";
import type { Memento } from "vscode";

const moduleAny = Module as unknown as {
  _load: (...args: unknown[]) => unknown;
};
const originalLoad = moduleAny._load;
moduleAny._load = function patchedLoad(...args: unknown[]) {
  const [request, parent, isMain] = args as [
    string,
    NodeModule | undefined,
    boolean,
  ];
  if (request === "vscode") {
    class MockEventEmitter<T> {
      private listeners = new Set<(value: T) => unknown>();

      event = (listener: (value: T) => unknown) => {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
      };

      fire(value: T) {
        for (const listener of [...this.listeners]) {
          listener(value);
        }
      }

      dispose() {
        this.listeners.clear();
      }
    }

    return {
      EventEmitter: MockEventEmitter,
    };
  }
  return originalLoad.apply(this, args);
};

import { TaskStore } from "../src/taskStore";
import { Task } from "../src/types";

class FakeMemento {
  private store = new Map<string, unknown>();

  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  get<T>(key: string, defaultValue?: T): T | undefined {
    if (this.store.has(key)) {
      return this.store.get(key) as T;
    }
    return defaultValue;
  }

  async update(key: string, value: unknown) {
    this.store.set(key, value);
  }

  keys(): readonly string[] {
    return Array.from(this.store.keys());
  }
}

(async () => {
  const memento = new FakeMemento();
  const store = new TaskStore(memento as unknown as Memento);

  const created = await store.create({
    title: "Prototype API",
    priority: "high",
    description: "Draft the REST contract",
    tags: ["api", "backend"],
  });

  let tasks = store.getAll();
  assert.strictEqual(tasks.length, 1, "creates a task");
  assert.strictEqual(created.order, 0, "first task order is zero");
  assert.strictEqual(created.status, "todo", "tasks start as todo");

  const second = await store.create({
    title: "Write docs",
    priority: "high",
    tags: ["docs"],
  });
  tasks = store.getAll();
  assert.strictEqual(tasks.length, 2, "adds additional tasks");
  assert.strictEqual(second.order, 1, "second task sits after first");

  await store.update(created.id, { priority: "low" });
  tasks = store.getAll();
  const updated = tasks.find((task) => task.id === created.id)!;
  assert.strictEqual(updated.priority, "low");
  assert.strictEqual(updated.order, 0, "moving priority resets ordering");

  await store.toggle(created.id, "completed");
  tasks = store.getAll();
  const completed = tasks.find((task) => task.id === created.id)!;
  assert.strictEqual(completed.status, "completed");
  assert.ok(completed.completedAt, "marks completion timestamp");

  await store.reorder(second.id, "high", 0, "todo");
  tasks = store.getAll();
  const highPriority = tasks.filter(
    (task) => task.priority === "high" && task.status === "todo"
  );
  assert.strictEqual(
    highPriority[0].id,
    second.id,
    "reordering moves task to front"
  );

  const removed = await store.removeCompleted();
  assert.strictEqual(removed, 1, "removes completed tasks in bulk");
  tasks = store.getAll();
  assert.ok(
    tasks.every((task) => task.status !== "completed"),
    "no completed tasks remain"
  );

  const bundle = store.exportTasks();
  assert.strictEqual(
    bundle.pending.length,
    1,
    "export lists pending tasks separately"
  );
  assert.strictEqual(
    bundle.completed.length,
    0,
    "export lists completed tasks separately"
  );

  const imported: Task[] = [
    {
      id: "custom-id",
      title: "Imported",
      description: undefined,
      priority: "medium",
      tags: [],
      dueDate: undefined,
      status: "todo",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      order: 0,
    },
  ];

  await store.importTasks(imported);
  tasks = store.getAll();
  assert.strictEqual(tasks.length, 1, "import replaces tasks");
  assert.strictEqual(tasks[0].id, "custom-id");

  store.dispose();
  console.log("TaskStore tests passed");
})();
