import { createHashRouter, Navigate, Outlet, RouterProvider } from 'react-router-dom'
import {
  RedirectIfAuthenticated,
  RequireAuth,
  RequireBusinessSelected,
} from '../features/auth/auth-provider'
import { LoginPage } from '../features/auth/pages/login-page'
import { SelectBusinessPage } from '../features/auth/pages/select-business-page'
import { TourProvider } from '../features/onboarding/tour-provider'
import { CategoriesPage } from '../features/categories/pages/categories-page'
import { CustomerDetailPage } from '../features/customers/pages/customer-detail-page'
import { CustomersPage } from '../features/customers/pages/customers-page'
import { DashboardPage } from '../features/dashboard/pages/dashboard-page'
import { IncidentReportsPage } from '../features/incident-reports/pages/incident-reports-page'
import { IncomeSharePage } from '../features/income-share/pages/income-share-page'
import { InventoryPage } from '../features/inventory/pages/inventory-page'
import { InventoryMovementsPage } from '../features/inventory/pages/inventory-movements-page'
import { InventoryCategoriesPage } from '../features/inventory/pages/inventory-categories-page'
import { InventorySummaryPage } from '../features/inventory/pages/inventory-summary-page'
import { InventoryTemplatesPage } from '../features/inventory/pages/inventory-templates-page'
import { SettingsPage } from '../features/settings/pages/settings-page'
import { BulkPayrollPage } from '../features/staff/pages/bulk-payroll-page'
import { StaffDetailPage } from '../features/staff/pages/staff-detail-page'
import { StaffPage } from '../features/staff/pages/staff-page'
import { TransactionDetailPage } from '../features/transactions/pages/transaction-detail-page'
import { TransactionsPage } from '../features/transactions/pages/transactions-page'
import { TransactionsSummaryPage } from '../features/transactions/pages/transactions-summary-page'
import { UsersPage } from '../features/users/pages/users-page'
import { AppShell } from './shell/app-shell'

// Wraps every authenticated route so the onboarding tour provider has access
// to both the auth context and the react-router location/navigation hooks.
function AuthenticatedLayout() {
  return (
    <TourProvider>
      <Outlet />
    </TourProvider>
  )
}

const router = createHashRouter([
  {
    path: '/',
    element: <RequireAuth />,
    children: [
      {
        element: <AuthenticatedLayout />,
        children: [
      {
        index: true,
        element: <Navigate replace to="/dashboard" />,
      },
      {
        path: '/select-business',
        element: <SelectBusinessPage />,
      },
      {
        element: <RequireBusinessSelected />,
        children: [
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
                path: '/transactions-summary',
                element: <TransactionsSummaryPage />,
              },
              {
                path: '/transactions/:id',
                element: <TransactionDetailPage />,
              },
              {
                path: '/customers',
                element: <CustomersPage />,
              },
              {
                path: '/customers/:id',
                element: <CustomerDetailPage />,
              },
              {
                path: '/staff',
                element: <StaffPage />,
              },
              {
                path: '/staff/:id',
                element: <StaffDetailPage />,
              },
              {
                path: '/payroll',
                element: <BulkPayrollPage />,
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
                path: '/inventory-categories',
                element: <InventoryCategoriesPage />,
              },
              {
                path: '/inventory-templates',
                element: <InventoryTemplatesPage />,
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
