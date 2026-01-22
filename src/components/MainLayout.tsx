import React from 'react';
import { Outlet } from 'react-router-dom';
import Navbar from './Navbar'; // Descomentado para renderizar a Navbar
import { useAuth } from '../context/AuthContext';
import { usePushNotifications } from '../hooks/usePushNotifications';

const MainLayout: React.FC = () => {
  const { user } = useAuth();
  
  // Ativar notificações push para o usuário logado
  usePushNotifications(user?.id);

  return (
    <div className="flex flex-col min-h-screen">
      <Navbar /> {/* Descomentado para renderizar a Navbar */}
      <main className="flex-grow">
        <Outlet />
      </main>
      {/* Footer pode ser adicionado aqui se necessário */}
    </div>
  );
};

export default MainLayout;
