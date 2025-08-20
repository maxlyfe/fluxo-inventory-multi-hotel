// src/App.tsx

// Importações de bibliotecas e componentes.
import React from 'react';
import {
  BrowserRouter, Routes, Route, Navigate,
} from 'react-router-dom';
import Home from './pages/Home';
import SectorRequests from './pages/SectorRequests';
import AdminPanel from './pages/AdminPanel';
import ManagementPanel from './pages/ManagementPanel';
import Inventory from './pages/Inventory';
import ShoppingList from './pages/ShoppingList';
import Login from './pages/Login';
import UserManagement from './pages/UserManagement';
import Governance from './pages/Governance';
import HotelSelection from './pages/HotelSelection';
import SectorStock from './pages/SectorStock';
import NewPurchase from './pages/NewPurchase';
import PurchaseOrders from './pages/PurchaseOrders';
import NewPurchaseList from './pages/NewPurchaseList';
import OnlinePurchaseList from './pages/OnlinePurchaseList';
import BudgetHistory from './pages/BudgetHistory';
import BudgetDetail from './pages/BudgetDetail';
import FinancialManagement from './pages/FinancialManagement';
import AuthorizationsPage from './pages/AuthorizationsPage';
import PrivateRoute from './components/PrivateRoute';
import MainLayout from './components/MainLayout';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { HotelProvider } from './context/HotelContext';
import { NotificationProvider } from './context/NotificationContext';
import Toast from './components/ui/Toast';
import ReportsPage from './pages/ReportsPage';
import DynamicBudgetCreation from './pages/DynamicBudgetCreation';
import PublicQuotePage from './pages/PublicQuotePage';
import BudgetAnalysis from './pages/BudgetAnalysis';
import PersonnelDepartmentPage from './pages/PersonnelDepartmentPage';

// --- NOVO: Importação do nosso componente de Chatbot ---
import Chatbot from './components/Chatbot';


// Componente principal da aplicação que define as rotas.
function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <NotificationProvider>
          <BrowserRouter>
            <HotelProvider>
              <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors duration-200">
                <Toast />
                <Routes>
                  {/* Rotas públicas */}
                  <Route path="/login" element={<Login />} />
                  <Route path="/select-hotel" element={<HotelSelection />} />
                  <Route path="/quote/:budgetId" element={<PublicQuotePage />} />

                  {/* Rotas privadas que usam o MainLayout (com Navbar) */}
                  <Route element={<MainLayout />}>
                    <Route path="/" element={<Home />} />
                    <Route path="/sector/:id" element={<SectorRequests />} />
                    <Route
                      path="/admin"
                      element={
                        <PrivateRoute roles={['admin', 'inventory']}>
                          <AdminPanel />
                        </PrivateRoute>
                      }
                    />
                    <Route
                      path="/management"
                      element={
                        <PrivateRoute roles={['admin', 'management', 'sup-governanca']}>
                          <ManagementPanel />
                        </PrivateRoute>
                      }
                    />
                    <Route
                      path="/inventory"
                      element={
                        <PrivateRoute roles={['admin', 'inventory']}>
                          <Inventory />
                        </PrivateRoute>
                      }
                    />
                    <Route
                      path="/reports"
                      element={
                        <PrivateRoute roles={['admin', 'inventory']}>
                          <ReportsPage />
                        </PrivateRoute>
                      }
                    />
                    <Route
                      path="/shopping-list"
                      element={
                        <PrivateRoute roles={['admin', 'inventory']}>
                          <ShoppingList />
                        </PrivateRoute>
                      }
                    />
                    <Route
                      path="/users"
                      element={
                        <PrivateRoute roles={['admin']}>
                          <UserManagement />
                        </PrivateRoute>
                      }
                    />
                    <Route
                      path="/governance"
                      element={
                        <PrivateRoute roles={['admin', 'sup-governanca']}>
                          <Governance />
                        </PrivateRoute>
                      }
                    />
                    <Route
                      path="/sector-stock/:sectorId"
                      element={
                        <PrivateRoute roles={['admin', 'sup-governanca']}>
                          <SectorStock />
                        </PrivateRoute>
                      }
                    />
                    <Route
                      path="/inventory/new-purchase"
                      element={
                        <PrivateRoute roles={['admin', 'inventory']}>
                          <NewPurchase />
                        </PrivateRoute>
                      }
                    />
                    <Route
                      path="/purchases"
                      element={
                        <PrivateRoute roles={['admin', 'inventory']}>
                          <PurchaseOrders />
                        </PrivateRoute>
                      }
                    />
                    <Route
                      path="/purchases/list"
                      element={
                        <PrivateRoute roles={['admin', 'inventory']}>
                          <NewPurchaseList />
                        </PrivateRoute>
                      }
                    />
                    <Route
                      path="/purchases/dynamic-budget/new"
                      element={
                        <PrivateRoute roles={['admin', 'inventory']}>
                          <DynamicBudgetCreation />
                        </PrivateRoute>
                      }
                    />
                    <Route
                      path="/purchases/dynamic-budget/analysis/:budgetId"
                      element={
                        <PrivateRoute roles={['admin', 'inventory']}>
                          <BudgetAnalysis />
                        </PrivateRoute>
                      }
                    />
                    <Route
                      path="/purchases/online"
                      element={
                        <PrivateRoute roles={['admin', 'inventory']}>
                          <OnlinePurchaseList />
                        </PrivateRoute>
                      }
                    />
                    <Route
                      path="/budget-history"
                      element={
                        <PrivateRoute roles={['admin', 'inventory']}>
                          <BudgetHistory />
                        </PrivateRoute>
                      }
                    />
                    <Route
                      path="/budget/:budgetId"
                      element={
                        <PrivateRoute roles={['admin', 'inventory']}>
                          <BudgetDetail />
                        </PrivateRoute>
                      }
                    />
                    <Route
                      path="/finances"
                      element={
                        <PrivateRoute roles={["admin"]}>
                          <FinancialManagement />
                        </PrivateRoute>
                      }
                    />
                    <Route
                      path="/authorizations"
                      element={
                        <PrivateRoute roles={["admin", "inventory"]}>
                          <AuthorizationsPage />
                        </PrivateRoute>
                      }
                    />
                    
                    <Route
                      path="/personnel-department"
                      element={
                        <PrivateRoute roles={['admin', 'management']}>
                          <PersonnelDepartmentPage />
                        </PrivateRoute>
                      }
                    />

                    {/* Rota de fallback, redireciona para a home se nenhuma outra corresponder */}
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Route>
                </Routes>
                
                {/* --- NOVO: Chatbot adicionado aqui, fora das rotas --- */}
                <Chatbot />
              </div>
            </HotelProvider>
          </BrowserRouter>
        </NotificationProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}

export default App;
