import React from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { useNotification } from '../../context/NotificationContext'; // Ajuste o caminho se necessário

type NotificationType = 'success' | 'error' | 'info' | 'warning';

/**
 * Componente para exibir notificações (toasts) na tela.
 * Utiliza o NotificationContext para obter a lista de notificações.
 */
const Toast: React.FC = () => {
  const { notifications, removeNotification } = useNotification();

  // Não renderiza nada se não houver notificações
  if (notifications.length === 0) {
    return null;
  }

  // Função para obter o ícone apropriado com base no tipo de notificação
  const getIcon = (type: NotificationType) => {
    switch (type) {
      case 'success':
        return <CheckCircle className="h-5 w-5 text-green-500" aria-hidden="true" />;
      case 'error':
        return <AlertCircle className="h-5 w-5 text-red-500" aria-hidden="true" />;
      case 'warning':
        return <AlertTriangle className="h-5 w-5 text-yellow-500" aria-hidden="true" />;
      case 'info':
      default:
        return <Info className="h-5 w-5 text-blue-500" aria-hidden="true" />;
    }
  };

  // Função para obter as classes CSS apropriadas com base no tipo de notificação
  const getToastClass = (type: NotificationType) => {
    switch (type) {
      case 'success':
        return 'bg-green-50 border-green-200 text-green-800 dark:bg-green-900/30 dark:border-green-800 dark:text-green-200';
      case 'error':
        return 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/30 dark:border-red-800 dark:text-red-200';
      case 'warning':
        return 'bg-yellow-50 border-yellow-200 text-yellow-800 dark:bg-yellow-900/30 dark:border-yellow-800 dark:text-yellow-200';
      case 'info':
      default:
        return 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-200';
    }
  };

  return (
    // Container fixo no canto inferior direito da tela
    <div 
      className="fixed bottom-4 right-4 z-50 flex flex-col space-y-2 max-w-md w-full sm:w-auto"
      role="region"
      aria-live="polite"
      aria-label="Notificações"
    >
      {notifications.map((notification) => (
        // Cada notificação individual
        <div
          key={notification.id}
          className={`flex items-start p-4 rounded-lg shadow-lg border ${getToastClass(notification.type)} transition-all duration-300 ease-in-out transform translate-x-0 opacity-100 hover:shadow-xl`}
          role="alert"
        >
          {/* Ícone */}
          <div className="flex-shrink-0 mr-3">
            {getIcon(notification.type)}
          </div>
          {/* Mensagem */}
          <div className="flex-1 mr-2">
            <p className="text-sm font-medium">{notification.message}</p>
          </div>
          {/* Botão de fechar */}
          <button
            onClick={() => removeNotification(notification.id)}
            className="flex-shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 rounded-full p-1 -m-1"
            aria-label="Fechar notificação"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
};

export default Toast;
