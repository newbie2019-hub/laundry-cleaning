import { useTheme } from 'next-themes'
import { Toaster } from 'sonner'

export function AppToaster() {
  const { resolvedTheme } = useTheme()
  return (
    <Toaster
      closeButton
      position="bottom-right"
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
    />
  )
}
