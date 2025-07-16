import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Bell, CheckCheck, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext'; // Ajuste o caminho se necessário
import { 
    getNotificationsForUser, // Corrigido de getUserNotifications
    getUnreadNotificationsCount, 
    markNotificationAsRead, 
    markAllNotificationsAsRead,
    // Notification // O tipo Notification deve ser definido localmente ou importado se existir em notifications.ts
} from '../lib/notifications'; // Ajuste o caminho se necessário
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// Definição do tipo Notification, caso não venha de notifications.ts
interface Notification {
    id: string;
    created_at: string; // ou Date
    is_read: boolean;
    message: string;
    title?: string; // Adicionado para corresponder ao uso
    target_path?: string | null; // Adicionado para corresponder ao uso
    related_entity_id?: string | null;
    related_entity_type?: string | null;
    notification_types?: {
        description?: string;
        event_key?: string;
    } | null;
    hotels?: { name?: string } | null;
    sectors?: { name?: string } | null;
}

const NotificationBell: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const notificationsPerPage = 5;

  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchUnreadCount = useCallback(async () => {
    if (user?.id) {
      try {
        const count = await getUnreadNotificationsCount(user.id);
        setUnreadCount(count);
      } catch (error) {
        console.error('Failed to fetch unread notifications count:', error);
      }
    }
  }, [user?.id]);

  const fetchNotifications = useCallback(async (page: number) => {
    if (user?.id) {
      setLoading(true);
      try {
        // Ajustado para usar getNotificationsForUser e passar page e notificationsPerPage
        const result = await getNotificationsForUser(user.id, page, notificationsPerPage);
        setNotifications(result.data);
        setTotalPages(Math.ceil((result.count || 0) / notificationsPerPage));
      } catch (error) {
        console.error('Failed to fetch notifications:', error);
        setNotifications([]);
      } finally {
        setLoading(false);
      }
    }
  }, [user?.id, notificationsPerPage]); // Adicionado notificationsPerPage às dependências

  useEffect(() => {
    fetchUnreadCount();
    const intervalId = setInterval(fetchUnreadCount, 60000); 
    return () => clearInterval(intervalId);
  }, [fetchUnreadCount]);

  useEffect(() => {
    if (isOpen) {
      setCurrentPage(1); 
      fetchNotifications(1);
    }
  }, [isOpen, fetchNotifications]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleToggleDropdown = () => {
    setIsOpen(!isOpen);
  };

  const handleNotificationClick = async (notification: Notification) => {
    if (user?.id && !notification.is_read) {
      try {
        // A função markNotificationAsRead em notifications.ts não espera user.id como segundo argumento.
        // Se for necessário, precisará ser ajustada lá.
        await markNotificationAsRead(notification.id);
        fetchUnreadCount(); 
        setNotifications(prev => 
          prev.map(n => n.id === notification.id ? { ...n, is_read: true } : n)
        );
      } catch (error) {
        console.error('Failed to mark notification as read:', error);
      }
    }
    if (notification.target_path) {
      navigate(notification.target_path);
    }
    setIsOpen(false);
  };

  const handleMarkAllAsRead = async () => {
    if (user?.id) {
      setLoading(true);
      try {
        await markAllNotificationsAsRead(user.id);
        fetchUnreadCount();
        fetchNotifications(currentPage); 
      } catch (error) {
        console.error('Failed to mark all notifications as read:', error);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      const nextPage = currentPage + 1;
      setCurrentPage(nextPage);
      fetchNotifications(nextPage);
    }
  };

  const handlePreviousPage = () => {
    if (currentPage > 1) {
      const prevPage = currentPage - 1;
      setCurrentPage(prevPage);
      fetchNotifications(prevPage);
    }
  };

  if (!user) return null; 

  return (
    <div className="relative" ref={dropdownRef}>
      <button 
        onClick={handleToggleDropdown} 
        className="relative p-2 rounded-full text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-100 dark:focus:ring-offset-gray-800 focus:ring-indigo-500"
        aria-label="Notifications"
      >
        <Bell size={24} />
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 block h-5 w-5 transform -translate-y-1/2 translate-x-1/2 rounded-full bg-red-500 text-white text-xs flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white dark:bg-gray-800 rounded-lg shadow-xl border dark:border-gray-700 z-50 overflow-hidden">
          <div className="p-3 flex justify-between items-center border-b dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Notificações</h3>
            <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                <X size={18}/>
            </button>
          </div>

          {loading && notifications.length === 0 && <p className="p-4 text-center text-xs text-gray-500 dark:text-gray-400">Carregando...</p>}
          {!loading && notifications.length === 0 && <p className="p-4 text-center text-xs text-gray-500 dark:text-gray-400">Nenhuma notificação nova.</p>}
          
          {notifications.length > 0 && (
            <ul className="divide-y dark:divide-gray-700 max-h-96 overflow-y-auto">
              {notifications.map((notification) => (
                <li key={notification.id} 
                    className={`p-3 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer ${!notification.is_read ? 'bg-blue-50 dark:bg-blue-900/30' : ''}`}
                    onClick={() => handleNotificationClick(notification)}
                >
                  <div className="flex items-start space-x-2">
                    <div className="flex-grow">
                      <p className={`text-xs font-semibold text-gray-800 dark:text-gray-100 ${!notification.is_read ? 'font-bold' : ''}`}>{notification.title || 'Notificação'}</p>
                      <p className={`text-xs text-gray-600 dark:text-gray-300 ${!notification.is_read ? 'font-semibold' : ''}`}>{notification.message}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true, locale: ptBR })}
                      </p>
                    </div>
                    {!notification.is_read && (
                        <div className="flex-shrink-0 pt-0.5">
                            <span className="block h-2 w-2 rounded-full bg-blue-500"></span>
                        </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {(notifications.length > 0 || unreadCount > 0) && (
            <div className="p-2 border-t dark:border-gray-700 flex justify-between items-center">
              <button 
                onClick={handleMarkAllAsRead} 
                disabled={loading || unreadCount === 0}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
              >
                <CheckCheck size={14} className="mr-1"/> Marcar todas como lidas
              </button>
              {totalPages > 1 && (
                <div className="flex items-center space-x-1">
                  <button onClick={handlePreviousPage} disabled={currentPage === 1 || loading} className="p-1 text-xs rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50">
                    Anterior
                  </button>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{currentPage}/{totalPages}</span>
                  <button onClick={handleNextPage} disabled={currentPage === totalPages || loading} className="p-1 text-xs rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50">
                    Próxima
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationBell;

