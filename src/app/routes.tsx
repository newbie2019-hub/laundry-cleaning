import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom'
import { RedirectIfAuthenticated, RequireAuth } from '../features/auth/auth-provider'
import { LoginPage } from '../features/auth/pages/login-page'
import { CategoriesPage } from '../features/categories/pages/categories-page'
import { DashboardPage } from '../features/dashboard/pages/dashboard-page'
import { IncidentReportsPage } from '../features/incident-reports/pages/incident-reports-page'
import { IncomeSharePage } from '../features/income-share/pages/income-share-page'
import { InventoryPage } from '../features/inventory/pages/inventory-page'
import { InventoryMovementsPage } from '../features/inventory/pages/inventory-movements-page'
import { InventorySummaryPage } from '../features/inventory/pages/inventory-summary-page'
import { SettingsPage } from '../features/settings/pages/settings-page'
import { TransactionsPage } from '../features/transactions/pages/transactions-page'
import { UsersPage } from '../features/users/pages/users-page'
import { AppShell } from './shell/app-shell'

const router = createHashRouter([
  {
    path: '/',
    element: <RequireAuth />,
    children: [
      {
        index: true,
        element: <Navigate replace to="/dashboard" />,
      },
      {
        element: <AppShell />,
        children: [
          {
            path: '/dashboard',
            element: <DashboardPage />,
          },
          {
            path: '/transactions',
            element: <TransactionsPage />,
          },
          {
            path: '/incident-reports',
            element: <IncidentReportsPage />,
          },
          {
            path: '/inventory',
            element: <InventoryPage />,
          },
          {
            path: '/inventory-movements',
            element: <InventoryMovementsPage />,
          },
          {
            path: '/inventory-summary',
            element: <InventorySummaryPage />,
          },
          {
            path: '/categories',
            element: <CategoriesPage />,
          },
          {
            path: '/income-share',
            element: <IncomeSharePage />,
          },
          {
            path: '/users',
            element: <UsersPage />,
          },
          {
            path: '/settings',
            element: <SettingsPage />,
          },
        ],
      },
    ],
  },
  {
    path: '/login',
    element: (
      <RedirectIfAuthenticated>
        <LoginPage />
      </RedirectIfAuthenticated>
    ),
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
