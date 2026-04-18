import type { PropsWithChildren } from 'react'
import { ThemeProvider } from 'next-themes'
import { AuthProvider } from '../features/auth/auth-provider'
import { AppToaster } from './app-toaster'

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      disableTransitionOnChange
      enableSystem
    >
      <AuthProvider>
        {children}
        <AppToaster />
      </AuthProvider>
    </ThemeProvider>
  )
}
