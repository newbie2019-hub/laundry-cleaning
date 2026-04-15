import type { PropsWithChildren } from 'react'
import { ThemeProvider } from 'next-themes'
import { AuthProvider } from '../features/auth/auth-provider'

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      disableTransitionOnChange
      enableSystem
    >
      <AuthProvider>{children}</AuthProvider>
    </ThemeProvider>
  )
}
