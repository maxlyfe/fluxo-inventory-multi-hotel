import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

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

   let _notifCounter = 0;

   export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
     const [notifications, setNotifications] = useState<Notification[]>([]);
     const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

     const removeNotification = useCallback((id: string) => {
       const timer = timersRef.current.get(id);
       if (timer) { clearTimeout(timer); timersRef.current.delete(id); }
       setNotifications(prev => prev.filter(n => n.id !== id));
     }, []);

     const addNotification = useCallback((typeOrMsg: NotificationType | string, msgOrType?: string, duration = 5000) => {
       // Aceita ambas as ordens: (type, message) e (message, type) para backward compat
       let type: NotificationType;
       let message: string;

       const validTypes: NotificationType[] = ['success', 'error', 'info', 'warning'];
       if (validTypes.includes(typeOrMsg as NotificationType) && msgOrType) {
         type = typeOrMsg as NotificationType;
         message = msgOrType;
       } else if (msgOrType && validTypes.includes(msgOrType as NotificationType)) {
         type = msgOrType as NotificationType;
         message = typeOrMsg;
       } else {
         type = 'info';
         message = typeOrMsg;
       }

       const id = `notif_${++_notifCounter}_${Date.now()}`;

       setNotifications(prev => [...prev, { id, type, message, duration }]);

       if (duration > 0) {
         const timer = setTimeout(() => {
           timersRef.current.delete(id);
           setNotifications(prev => prev.filter(n => n.id !== id));
         }, duration);
         timersRef.current.set(id, timer);
       }

       return id;
     }, []);

     return (
       <NotificationContext.Provider value={{ notifications, addNotification, removeNotification }}>
         {children}
       </NotificationContext.Provider>
     );
   };
