import type { PropsWithChildren } from 'react'
import { ThemeProvider } from 'next-themes'
import { AuthProvider } from '../features/auth/auth-provider'
import { AppToaster } from './app-toaster'
import { UpdaterProvider } from './updater-context'
import { useAppUpdater } from './use-app-updater'

function UpdateChecker() {
  useAppUpdater()
  return null
}

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      disableTransitionOnChange
      enableSystem
    >
      <UpdaterProvider>
        <AuthProvider>
          <UpdateChecker />
          {children}
          <AppToaster />
        </AuthProvider>
      </UpdaterProvider>
    </ThemeProvider>
  )
}
