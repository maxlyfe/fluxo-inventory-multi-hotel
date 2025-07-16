import React, { createContext, useContext, useState, useCallback } from 'react';

   type NotificationType = 'success' | 'error' | 'info' | 'warning';

   interface Notification {
     id: string;
     type: NotificationType;
     message: string;
     duration?: number;
   }

   interface NotificationContextType {
     notifications: Notification[];
     addNotification: (type: NotificationType, message: string, duration?: number) => void;
     removeNotification: (id: string) => void;
   }

   const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

   export const useNotification = () => {
     const context = useContext(NotificationContext);
     if (!context) {
       throw new Error('useNotification must be used within a NotificationProvider');
     }
     return context;
   };

   export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
     const [notifications, setNotifications] = useState<Notification[]>([]);

     const addNotification = useCallback((type: NotificationType, message: string, duration = 5000) => {
       const id = Date.now().toString();
       
       setNotifications(prev => [...prev, { id, type, message, duration }]);
       
       if (duration > 0) {
         setTimeout(() => {
           removeNotification(id);
         }, duration);
       }
       
       return id;
     }, []);

     const removeNotification = useCallback((id: string) => {
       setNotifications(prev => prev.filter(notification => notification.id !== id));
     }, []);

     return (
       <NotificationContext.Provider value={{ notifications, addNotification, removeNotification }}>
         {children}
       </NotificationContext.Provider>
     );
   };