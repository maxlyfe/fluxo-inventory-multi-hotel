import React from 'react';
import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';
import Sidebar from './Sidebar';
import { useAuth } from '../context/AuthContext';
import { usePushNotifications } from '../hooks/usePushNotifications';

const MainLayout: React.FC = () => {
  const { user } = useAuth();
  
  // Ativar notificações push para o usuário logado
  usePushNotifications({ userId: user?.id });

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
      <Sidebar />
      <div className="flex flex-col flex-1 pl-16">
        <Navbar />
        <main className="flex-grow">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default MainLayout;
