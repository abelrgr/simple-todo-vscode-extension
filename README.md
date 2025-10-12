# simple-todo-vscode-extension

Lightweight VS Code extension for workspace-scoped todos to have a quick overview of pending tasks for the current project/workspace/repo.

## Quick start

1. npm install
2. npm run compile
3. Open in VS Code and press F5

## Main commands

- Add Task — create a task
- Import from JSON — load tasks from JSON
- Export to JSON — save tasks to JSON

## Contributing

Want to help? Short guide:

1. Fork the repo on GitHub and clone it locally.
2. Create a topic branch: `git checkout -b feature/my-change`.
3. Install and build locally, run lint/tests:

```cmd
git clone https://github.com/abelrgr/simple-todo-vscode-extension.git
cd simple-todo-vscode-extension
git checkout -b feature/my-change
npm install
npm run compile
npm run lint
npm test
```

4. Commit cleanly, push your branch and open a Pull Request describing the change.
5. Add tests for new behavior and update the README if needed.

Be concise in PR descriptions and follow existing code style.

## JSON export/import

- Export: saves a JSON bundle with `pending` and `completed` arrays.
- Import: accepts the same bundle or a legacy `tasks` array and replaces workspace tasks.

## Notes

- Tasks are stored in workspace state.
- Use export/import to backup or move tasks between workspaces.

## License

This project is licensed under the MIT License. See `LICENSE.md` for details.
