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
import TransferHistory       from './pages/TransferHistory';
import ShoppingList          from './pages/ShoppingList';
import Login                 from './pages/Login';
import UserManagement        from './pages/UserManagement';
import Governance            from './pages/Governance';
import HotelSelection        from './pages/HotelSelection';
import SectorStock           from './pages/SectorStock';
import NewPurchase           from './pages/NewPurchase';
import PurchaseOrders        from './pages/PurchaseOrders';
import MenuTechSheet         from './pages/MenuTechSheet';
import PurchaseHistory       from './pages/PurchaseHistory';
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

// ── Pages — Portal do Colaborador ─────────────────────────────────────────────
import EmployeePortal        from './pages/portal/EmployeePortal';
import MySchedule            from './pages/portal/MySchedule';
import MyDocuments           from './pages/portal/MyDocuments';
import EventsCalendar        from './pages/portal/EventsCalendar';
import MotivationalMessages  from './pages/portal/MotivationalMessages';

// ── Pages — RH (Recrutamento & Seleção) ─────────────────────────────────────
import JobOpenings           from './pages/rh/JobOpenings';
import CandidatesList        from './pages/rh/CandidatesList';
import CandidateDetail       from './pages/rh/CandidateDetail';
import CpfRegistry           from './pages/rh/CpfRegistry';
import PublicJobApplication  from './pages/rh/PublicJobApplication';
import HRAnalytics           from './pages/rh/HRAnalytics';
import DocumentsLicenses     from './pages/management/DocumentsLicenses';
import WCIManagement         from './pages/management/WCIManagement';

// ── Pages — Comercial ────────────────────────────────────────────────────────
import CorporateClients      from './pages/commercial/CorporateClients';
import GroupBookings         from './pages/commercial/GroupBookings';
import RevenueTargets        from './pages/commercial/RevenueTargets';

// ── Pages — Departamento Pessoal ──────────────────────────────────────────────
import PersonnelDepartmentPage from './pages/PersonnelDepartmentPage';
import DPEmployeeDetail        from './pages/dp/DPEmployeeDetail';
import PublicScheduleEdit      from './pages/dp/PublicScheduleEdit';
import NR1Dashboard            from './pages/dp/NR1Dashboard';
import TrainingRecords         from './pages/dp/TrainingRecords';
import MedicalExams            from './pages/dp/MedicalExams';

// ── Pages — Manutenção ───────────────────────────────────────────────────────
import MaintenanceDashboard      from './pages/MaintenanceDashboard';
import MaintenanceNewTicket      from './pages/MaintenanceNewTicket';
import MaintenanceTicketDetail   from './pages/MaintenanceTicketDetail';
import MaintenanceEquipment      from './pages/MaintenanceEquipment';
import MaintenanceEquipmentDetail from './pages/MaintenanceEquipmentDetail';

// ── Pages — Administração (novos) ─────────────────────────────────────────────
import RolesManagement    from './pages/admin/RolesManagement';
import SectorsManagement  from './pages/admin/SectorsManagement';
import ErbonIntegration     from './pages/admin/ErbonIntegration';
import WhatsAppIntegration from './pages/admin/WhatsAppIntegration';
import SupplierContacts    from './pages/SupplierContacts';
import { PrivacyPolicy, TermsOfService, DataDeletion } from './pages/LegalPages';

// ── Pages — Web Check-in (público) ───────────────────────────────────────────
import WebCheckinLayout      from './pages/webcheckin/WebCheckinLayout';
import WCIRestScreen         from './pages/webcheckin/WCIRestScreen';
import WCIHotelSelection     from './pages/webcheckin/WCIHotelSelection';
import WCIReservationSearch  from './pages/webcheckin/WCIReservationSearch';
import WCIGuestList          from './pages/webcheckin/WCIGuestList';
import WCIFNRHForm           from './pages/webcheckin/WCIFNRHForm';
import WCISignatureAndTerms  from './pages/webcheckin/WCISignatureAndTerms';
import WCICompanionEntry     from './pages/webcheckin/WCICompanionEntry';

// ── Pages — Erbon PMS (Recepção / Reservas) ─────────────────────────────────
import RoomRack          from './pages/erbon/RoomRack';
import InHouse           from './pages/erbon/InHouse';
import CheckInList       from './pages/erbon/CheckInList';
import CheckOutList      from './pages/erbon/CheckOutList';
import BookingSearch     from './pages/erbon/BookingSearch';
import RoomAvailability  from './pages/erbon/RoomAvailability';
import Planning          from './pages/erbon/Planning';

// ── Components ────────────────────────────────────────────────────────────────
import PrivateRoute from './components/PrivateRoute';
import MainLayout   from './components/MainLayout';
import Toast        from './components/ui/Toast';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import Chatbot      from './components/Chatbot';

// ── Contexts ──────────────────────────────────────────────────────────────────
import { ThemeProvider }        from './context/ThemeContext';
import { AuthProvider }         from './context/AuthContext';
import { HotelProvider }        from './context/HotelContext';
import { NotificationProvider } from './context/NotificationContext';

// ── Auth hook ─────────────────────────────────────────────────────────────────
import { useAuth } from './context/AuthContext';
import { usePermissions } from './hooks/usePermissions';

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
// ContactsRouteGuard — acesso a contatos por purchases OU categorias liberadas
// ---------------------------------------------------------------------------
function ContactsRouteGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { can, isAdmin, canAccessContacts } = usePermissions();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-white" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (isAdmin || can('purchases') || canAccessContacts) return <>{children}</>;
  return <Navigate to="/" replace />;
}

// ---------------------------------------------------------------------------
// App principal
// ---------------------------------------------------------------------------
function App() {
  return (
    <ErrorBoundary>
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

                  {/* ── RH — página pública de candidatura ──────────────── */}
                  <Route path="/jobs/:token" element={<PublicJobApplication />} />

                  {/* ── Manutenção — rotas públicas (anônimo / QR) ─────────── */}
                  <Route path="/maintenance/ticket/new"      element={<MaintenanceNewTicket />} />
                  <Route path="/maintenance/equipment/:qrId" element={<MaintenanceEquipmentDetail />} />

                  {/* ── Páginas legais (Meta / WhatsApp Business) ─────────── */}
                  <Route path="/privacy"       element={<PrivacyPolicy />} />
                  <Route path="/terms"         element={<TermsOfService />} />
                  <Route path="/data-deletion" element={<DataDeletion />} />

                  {/* ── Web Check-in público (totem / mobile — sem auth) ──── */}
                  <Route path="/web-checkin" element={<WebCheckinLayout />}>
                    <Route index element={<WCIRestScreen />} />
                    <Route path="hotels" element={<WCIHotelSelection />} />
                    <Route path=":hotelId/search" element={<WCIReservationSearch />} />
                    <Route path=":hotelId/guests/:bookingId" element={<WCIGuestList />} />
                    <Route path=":hotelId/fnrh/:bookingId/:guestId" element={<WCIFNRHForm />} />
                    <Route path=":hotelId/signature/:bookingId" element={<WCISignatureAndTerms />} />
                    {/* Fluxo mobile para acompanhante: FNRH + termos + assinatura */}
                    <Route path=":hotelId/companion/:bookingId" element={<WCICompanionEntry />} />
                    <Route path=":hotelId/companion/:bookingId/:guestId" element={<WCICompanionEntry />} />
                  </Route>

                  {/* ── Rotas privadas com MainLayout (Navbar) ──────────────── */}
                  <Route element={<MainLayout />}>

                    {/* Dashboard */}
                    <Route path="/" element={<Home />} />
                    <Route path="/sector/:id" element={<SectorRequests />} />

                    {/* ── Portal do Colaborador ──────────────────────────────── */}
                    <Route path="/portal" element={
                      <PrivateRoute module="employee_portal">
                        <EmployeePortal />
                      </PrivateRoute>
                    } />
                    <Route path="/portal/my-schedule" element={
                      <PrivateRoute module="employee_portal">
                        <MySchedule />
                      </PrivateRoute>
                    } />
                    <Route path="/portal/my-documents" element={
                      <PrivateRoute module="employee_portal">
                        <MyDocuments />
                      </PrivateRoute>
                    } />
                    <Route path="/portal/events" element={
                      <PrivateRoute module="employee_portal">
                        <EventsCalendar />
                      </PrivateRoute>
                    } />
                    <Route path="/portal/messages" element={
                      <PrivateRoute module="employee_portal">
                        <MotivationalMessages />
                      </PrivateRoute>
                    } />

                    {/* ── RH — Recrutamento & Seleção ─────────────────── */}
                    <Route path="/rh/jobs" element={
                      <PrivateRoute module="recruitment">
                        <JobOpenings />
                      </PrivateRoute>
                    } />
                    <Route path="/rh/candidates" element={
                      <PrivateRoute module="recruitment">
                        <CandidatesList />
                      </PrivateRoute>
                    } />
                    <Route path="/rh/candidate/:id" element={
                      <PrivateRoute module="recruitment">
                        <CandidateDetail />
                      </PrivateRoute>
                    } />
                    <Route path="/rh/cpf-registry" element={
                      <PrivateRoute module="cpf_registry">
                        <CpfRegistry />
                      </PrivateRoute>
                    } />
                    <Route path="/rh/analytics" element={
                      <PrivateRoute module="hr_analytics">
                        <HRAnalytics />
                      </PrivateRoute>
                    } />

                    {/* Admin / gestão interna */}
                    <Route path="/admin" element={
                      <PrivateRoute module="stock">
                        <AdminPanel />
                      </PrivateRoute>
                    } />

                    <Route path="/management" element={
                      <PrivateRoute module="management">
                        <ManagementPanel />
                      </PrivateRoute>
                    } />
                    <Route path="/management/documents" element={
                      <PrivateRoute module="hotel_documents">
                        <DocumentsLicenses />
                      </PrivateRoute>
                    } />
                    <Route path="/management/webcheckin" element={
                      <PrivateRoute module="management">
                        <WCIManagement />
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

                    <Route path="/admin/erbon" element={
                      <PrivateRoute adminOnly>
                        <ErbonIntegration />
                      </PrivateRoute>
                    } />

                    <Route path="/admin/whatsapp" element={
                      <PrivateRoute adminOnly>
                        <WhatsAppIntegration />
                      </PrivateRoute>
                    } />

                    <Route path="/admin/supplier-contacts" element={
                      <ContactsRouteGuard>
                        <SupplierContacts />
                      </ContactsRouteGuard>
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

                    <Route path="/inventory/transfers" element={
                      <PrivateRoute module="inventory">
                        <TransferHistory />
                      </PrivateRoute>
                    } />

                    {/* ── Relatórios ───────────────────────────────────────── */}
                    <Route path="/reports" element={
                      <PrivateRoute module="reports">
                        <ReportsPage />
                      </PrivateRoute>
                    } />

                    {/* ── Comercial ─────────────────────────────────────── */}
                    <Route path="/commercial/clients" element={
                      <PrivateRoute module="commercial">
                        <CorporateClients />
                      </PrivateRoute>
                    } />
                    <Route path="/commercial/groups" element={
                      <PrivateRoute module="commercial">
                        <GroupBookings />
                      </PrivateRoute>
                    } />
                    <Route path="/commercial/targets" element={
                      <PrivateRoute module="commercial">
                        <RevenueTargets />
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

                    <Route path="/purchases/tech-sheets" element={
                      <PrivateRoute module="purchases">
                        <MenuTechSheet />
                      </PrivateRoute>
                    } />

                    <Route path="/purchases/history" element={
                      <PrivateRoute module="purchases">
                        <PurchaseHistory />
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
                    <Route path="/dp/nr1" element={
                      <PrivateRoute module="nr1_compliance">
                        <NR1Dashboard />
                      </PrivateRoute>
                    } />
                    <Route path="/dp/trainings" element={
                      <PrivateRoute module="nr1_compliance">
                        <TrainingRecords />
                      </PrivateRoute>
                    } />
                    <Route path="/dp/medical-exams" element={
                      <PrivateRoute module="nr1_compliance">
                        <MedicalExams />
                      </PrivateRoute>
                    } />

                    {/* ── Recepção (Erbon) ────────────────────────────────── */}
                    <Route path="/reception/rack" element={
                      <PrivateRoute modules={['reception']}>
                        <RoomRack />
                      </PrivateRoute>
                    } />
                    <Route path="/reception/checkin" element={
                      <PrivateRoute modules={['reception']}>
                        <CheckInList />
                      </PrivateRoute>
                    } />
                    <Route path="/reception/checkout" element={
                      <PrivateRoute modules={['reception']}>
                        <CheckOutList />
                      </PrivateRoute>
                    } />
                    <Route path="/reception/inhouse" element={
                      <PrivateRoute modules={['reception']}>
                        <InHouse />
                      </PrivateRoute>
                    } />

                    {/* ── Reservas (Erbon) ────────────────────────────────── */}
                    <Route path="/reservations/search" element={
                      <PrivateRoute modules={['reservations']}>
                        <BookingSearch />
                      </PrivateRoute>
                    } />
                    <Route path="/reservations/availability" element={
                      <PrivateRoute modules={['reservations']}>
                        <RoomAvailability />
                      </PrivateRoute>
                    } />
                    <Route path="/reservations/planning" element={
                      <PrivateRoute modules={['reservations']}>
                        <Planning />
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
    </ErrorBoundary>
  );
}

export default App;
