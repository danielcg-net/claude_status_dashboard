// API fetch wrappers for the browser client.
// Pure async functions — no DOM access, safe to stub in tests.

import type {
  ApiState,
  BeepSettingsUI,
  HooksSettingsUI,
  NotifySettingsUI,
  UpdateResult,
  UsageSummary,
  VersionInfo,
} from './ui-types.js'

const apiFetch = async <T>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`)
  }

  return response.json() as Promise<T>
}

export const loadState = async (): Promise<ApiState> => apiFetch<ApiState>('/api/sessions')

export const loadUsage = async (): Promise<UsageSummary> => apiFetch<UsageSummary>('/api/usage')

export const loadVersion = async (): Promise<VersionInfo> => apiFetch<VersionInfo>('/api/version')

export const loadNotifySettings = async (): Promise<NotifySettingsUI> =>
  apiFetch<NotifySettingsUI>('/api/settings/notify')

export const saveNotifySettings = async (settings: Record<string, unknown>): Promise<NotifySettingsUI> =>
  apiFetch<NotifySettingsUI>('/api/settings/notify', {
    method: 'PUT',
    body: JSON.stringify(settings),
  })

export const loadBeepSettings = async (): Promise<BeepSettingsUI> =>
  apiFetch<BeepSettingsUI>('/api/settings/beep')

export const saveBeepSettings = async (settings: Record<string, unknown>): Promise<BeepSettingsUI> =>
  apiFetch<BeepSettingsUI>('/api/settings/beep', {
    method: 'PUT',
    body: JSON.stringify(settings),
  })

export const loadHookSettings = async (): Promise<HooksSettingsUI> =>
  apiFetch<HooksSettingsUI>('/api/settings/hooks')

export const saveHookSettings = async (settings: Record<string, unknown>): Promise<HooksSettingsUI> =>
  apiFetch<HooksSettingsUI>('/api/settings/hooks', {
    method: 'PUT',
    body: JSON.stringify(settings),
  })

export const triggerUpdate = async (): Promise<UpdateResult> =>
  apiFetch<UpdateResult>('/api/update', { method: 'POST' })
