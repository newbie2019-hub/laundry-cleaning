import { AppProviders } from './app/providers'
import { AppRouter } from './app/routes'

function App() {
  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  )
}

export default App
