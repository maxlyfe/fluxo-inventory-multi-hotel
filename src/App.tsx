// src/App.tsx

import React from 'react';
import {
  BrowserRouter, Routes, Route, Navigate,
} from 'react-router-dom';

// ── Pages — Core ─────────────────────────────────────────────────────────────
import Home                  from './pages/Home';
import SectorRequests        from './pages/SectorRequests';
import AdminPanel            from './pages/AdminPanel';
import ManagementPanel       from './pages/ManagementPanel';
import Inventory             from './pages/Inventory';
import ShoppingList          from './pages/ShoppingList';
import Login                 from './pages/Login';
import UserManagement        from './pages/UserManagement';
import Governance            from './pages/Governance';
import HotelSelection        from './pages/HotelSelection';
import SectorStock           from './pages/SectorStock';
import NewPurchase           from './pages/NewPurchase';
import PurchaseOrders        from './pages/PurchaseOrders';
import NewPurchaseList       from './pages/NewPurchaseList';
import OnlinePurchaseList    from './pages/OnlinePurchaseList';
import BudgetHistory         from './pages/BudgetHistory';
import BudgetDetail          from './pages/BudgetDetail';
import FinancialManagement   from './pages/FinancialManagement';
import AuthorizationsPage    from './pages/AuthorizationsPage';
import ReportsPage           from './pages/ReportsPage';
import DynamicBudgetCreation from './pages/DynamicBudgetCreation';
import PublicQuotePage       from './pages/PublicQuotePage';
import BudgetAnalysis        from './pages/BudgetAnalysis';
import MultiHotelPurchase    from './pages/MultiHotelPurchase';

// ── Pages — Departamento Pessoal ──────────────────────────────────────────────
import PersonnelDepartmentPage from './pages/PersonnelDepartmentPage';
import DPEmployeeDetail        from './pages/dp/DPEmployeeDetail';
import PublicScheduleEdit      from './pages/dp/PublicScheduleEdit';

// ── Pages — Manutenção ───────────────────────────────────────────────────────
import MaintenanceDashboard      from './pages/MaintenanceDashboard';
import MaintenanceNewTicket      from './pages/MaintenanceNewTicket';
import MaintenanceTicketDetail   from './pages/MaintenanceTicketDetail';
import MaintenanceEquipment      from './pages/MaintenanceEquipment';
import MaintenanceEquipmentDetail from './pages/MaintenanceEquipmentDetail';

// ── Pages — Administração (novos) ─────────────────────────────────────────────
import RolesManagement   from './pages/admin/RolesManagement';
import SectorsManagement from './pages/admin/SectorsManagement';

// ── Components ────────────────────────────────────────────────────────────────
import PrivateRoute from './components/PrivateRoute';
import MainLayout   from './components/MainLayout';
import Toast        from './components/ui/Toast';
import Chatbot      from './components/Chatbot';

// ── Contexts ──────────────────────────────────────────────────────────────────
import { ThemeProvider }        from './context/ThemeContext';
import { AuthProvider }         from './context/AuthContext';
import { HotelProvider }        from './context/HotelContext';
import { NotificationProvider } from './context/NotificationContext';

// ── Auth hook ─────────────────────────────────────────────────────────────────
import { useAuth } from './context/AuthContext';

// ── Push notifications ────────────────────────────────────────────────────────
import { usePushNotifications } from './hooks/usePushNotifications';

// ---------------------------------------------------------------------------
// PushNotificationSetup
// Componente interno que ativa o push após o login.
// Precisa estar DENTRO do AuthProvider para acessar o useAuth().
// Não renderiza nada visualmente.
// ---------------------------------------------------------------------------
function PushNotificationSetup() {
  const { user } = useAuth();

  usePushNotifications({
    userId: user?.id,
    onForegroundNotification: ({ title, body }) => {
      if (title && Notification.permission === 'granted') {
        new Notification(title, {
          body:  body || '',
          icon:  '/icon-192x192.png',
          badge: '/icon-72x72.png',
        });
      }
    },
  });

  return null;
}

// ---------------------------------------------------------------------------
// App principal
// ---------------------------------------------------------------------------
function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <NotificationProvider>
          <BrowserRouter>
            <HotelProvider>
              <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors duration-200">

                <PushNotificationSetup />
                <Toast />

                <Routes>
                  {/* ── Rotas públicas ────────────────────────────────────── */}
                  <Route path="/login"           element={<Login />} />
                  <Route path="/select-hotel"    element={<HotelSelection />} />
                  <Route path="/quote/:budgetId" element={<PublicQuotePage />} />

                  {/* ── Escala pública (link para líder de setor) ────────── */}
                  <Route path="/schedule/edit/:token" element={<PublicScheduleEdit />} />

                  {/* ── Manutenção — rotas públicas (anônimo / QR) ─────────── */}
                  <Route path="/maintenance/ticket/new"      element={<MaintenanceNewTicket />} />
                  <Route path="/maintenance/equipment/:qrId" element={<MaintenanceEquipmentDetail />} />

                  {/* ── Rotas privadas com MainLayout (Navbar) ──────────────── */}
                  <Route element={<MainLayout />}>

                    {/* Dashboard */}
                    <Route path="/" element={<Home />} />
                    <Route path="/sector/:id" element={<SectorRequests />} />

                    {/* Admin / gestão interna */}
                    <Route path="/admin" element={
                      <PrivateRoute module="inventory">
                        <AdminPanel />
                      </PrivateRoute>
                    } />

                    <Route path="/management" element={
                      <PrivateRoute module="purchases">
                        <ManagementPanel />
                      </PrivateRoute>
                    } />

                    {/* ── Administração — Perfis & Setores ────────────────────
                        Acesso controlado internamente pelo usePermissions hook.
                        O PrivateRoute só exige login (roles=[]).             */}
                    <Route path="/admin/roles" element={
                      <PrivateRoute adminOnly>
                        <RolesManagement />
                      </PrivateRoute>
                    } />

                    <Route path="/admin/sectors" element={
                      <PrivateRoute adminOnly>
                        <SectorsManagement />
                      </PrivateRoute>
                    } />

                    {/* ── Usuários ────────────────────────────────────────── */}
                    <Route path="/users" element={
                      <PrivateRoute adminOnly>
                        <UserManagement />
                      </PrivateRoute>
                    } />

                    {/* ── Inventário ───────────────────────────────────────── */}
                    <Route path="/inventory" element={
                      <PrivateRoute module="inventory">
                        <Inventory />
                      </PrivateRoute>
                    } />

                    {/* ── Relatórios ───────────────────────────────────────── */}
                    <Route path="/reports" element={
                      <PrivateRoute module="reports">
                        <ReportsPage />
                      </PrivateRoute>
                    } />

                    {/* ── Compras ──────────────────────────────────────────── */}
                    <Route path="/shopping-list" element={
                      <PrivateRoute module="purchases">
                        <ShoppingList />
                      </PrivateRoute>
                    } />

                    <Route path="/inventory/new-purchase" element={
                      <PrivateRoute module="inventory">
                        <NewPurchase />
                      </PrivateRoute>
                    } />

                    <Route path="/purchases" element={
                      <PrivateRoute module="purchases">
                        <PurchaseOrders />
                      </PrivateRoute>
                    } />

                    <Route path="/purchases/list" element={
                      <PrivateRoute module="purchases">
                        <NewPurchaseList />
                      </PrivateRoute>
                    } />

                    <Route path="/purchases/multi-hotel" element={
                      <PrivateRoute module="purchases">
                        <MultiHotelPurchase />
                      </PrivateRoute>
                    } />

                    <Route path="/purchases/dynamic-budget/new" element={
                      <PrivateRoute module="purchases">
                        <DynamicBudgetCreation />
                      </PrivateRoute>
                    } />

                    <Route path="/purchases/dynamic-budget/analysis/:budgetId" element={
                      <PrivateRoute module="purchases">
                        <BudgetAnalysis />
                      </PrivateRoute>
                    } />

                    <Route path="/purchases/online" element={
                      <PrivateRoute module="purchases">
                        <OnlinePurchaseList />
                      </PrivateRoute>
                    } />

                    <Route path="/budget-history" element={
                      <PrivateRoute module="authorizations">
                        <BudgetHistory />
                      </PrivateRoute>
                    } />

                    <Route path="/budget/:budgetId" element={
                      <PrivateRoute module="authorizations">
                        <BudgetDetail />
                      </PrivateRoute>
                    } />

                    {/* ── Financeiro ───────────────────────────────────────── */}
                    <Route path="/finances" element={
                      <PrivateRoute adminOnly>
                        <FinancialManagement />
                      </PrivateRoute>
                    } />

                    {/* ── Autorizações ──────────────────────────────────────── */}
                    <Route path="/authorizations" element={
                      <PrivateRoute module="authorizations">
                        <AuthorizationsPage />
                      </PrivateRoute>
                    } />

                    {/* ── Governança / Stock de setor ───────────────────────── */}
                    <Route path="/governance" element={
                      <PrivateRoute module="stock">
                        <Governance />
                      </PrivateRoute>
                    } />

                    <Route path="/sector-stock/:sectorId" element={
                      <PrivateRoute module="stock">
                        <SectorStock />
                      </PrivateRoute>
                    } />

                    {/* ── Departamento Pessoal ──────────────────────────────── */}
                    <Route path="/personnel-department" element={
                      <PrivateRoute module="personnel_department">
                        <PersonnelDepartmentPage />
                      </PrivateRoute>
                    } />

                    <Route path="/dp/employee/:id" element={
                      <PrivateRoute module="personnel_department">
                        <DPEmployeeDetail />
                      </PrivateRoute>
                    } />

                    {/* ── Manutenções ───────────────────────────────────────── */}
                    <Route path="/maintenance" element={
                      <PrivateRoute module="maintenance">
                        <MaintenanceDashboard />
                      </PrivateRoute>
                    } />

                    <Route path="/maintenance/equipment" element={
                      <PrivateRoute module="maintenance">
                        <MaintenanceEquipment />
                      </PrivateRoute>
                    } />

                    <Route path="/maintenance/ticket/:id" element={
                      <PrivateRoute module="maintenance">
                        <MaintenanceTicketDetail />
                      </PrivateRoute>
                    } />

                    {/* Fallback — redireciona para home */}
                    <Route path="*" element={<Navigate to="/" replace />} />

                  </Route>{/* /MainLayout */}
                </Routes>

                {/* <Chatbot /> */}
              </div>
            </HotelProvider>
          </BrowserRouter>
        </NotificationProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}

export default App;
