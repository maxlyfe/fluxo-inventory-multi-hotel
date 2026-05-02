import React from 'react';
import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';
import Sidebar from './Sidebar';
import { useAuth } from '../context/AuthContext';
import { usePushNotifications } from '../hooks/usePushNotifications';

const MainLayout: React.FC = () => {
  const { user } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
  
  // Ativar notificações push para o usuário logado
  usePushNotifications({ userId: user?.id });

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
      <Sidebar isMobileOpen={isMobileMenuOpen} setIsMobileOpen={setIsMobileMenuOpen} />
      {/* pl-14 = offset do sidebar colapsado (w-14 = 3.5rem) em desktop; mobile sem offset */}
      <div className="flex flex-col flex-1 lg:pl-14">
        <Navbar onMenuToggle={() => setIsMobileMenuOpen(!isMobileMenuOpen)} />
        <main className="flex-grow">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default MainLayout;
