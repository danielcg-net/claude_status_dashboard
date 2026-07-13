# Toast Notification System

## What it does
`showToast(message, type, durationMs)` displays a transient notification in the bottom-right corner of the dashboard. Success toasts are green, error toasts are red. Auto-dismisses after 3.5 seconds with a CSS fade-out transition. A second toast replaces the previous one (no stacking).

## Where it's used
- Beeps panel: save button (`#beep-save`) and enable toggle (`#beep-enabled`)
- Notifications panel: save button (`#notify-save`) and enable toggle (`#notify-enabled`)
- Hooks panel: install button (`#hooks-install`) and delete button (`#hooks-delete`)

## Why it's safe from polling
The toast is appended to `document.body`, not `#app-body`. The 2-second polling cycle rebuilds only `#app-body` via `bodyWrapper.replaceChildren(...)`, so toasts are never touched by the refresh.

## Implementation
- `showToast()` in `src/client.ts` uses `createElement()` to build a `<div class="toast toast--success|error" role="status" data-testid="toast">`.
- CSS classes `.toast`, `.toast--visible`, `.toast--success`, `.toast--error` in `public/assets/styles.css`.
- `data-testid="toast"` for E2E testing with `page.getByTestId('toast')`.
