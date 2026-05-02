import React, { useEffect, useState, useRef } from 'react';
import { classNames } from '../../utils/search'; // Reutilizando helper se existir ou similar

interface LiveFlashProps {
  value: any;
  children: React.ReactNode;
  className?: string;
}

/**
 * Envolve um valor e dispara uma animação de brilho (flash) 
 * sempre que o valor mudar.
 */
export const LiveFlash: React.FC<LiveFlashProps> = ({ value, children, className }) => {
  const [isFlashing, setIsFlashing] = useState(false);
  const prevValue = useRef(value);

  useEffect(() => {
    // Se o valor mudou e não é a primeira renderização
    if (prevValue.current !== value) {
      setIsFlashing(true);
      
      // Remove o estado de flash após a animação (2s conforme CSS)
      const timer = setTimeout(() => setIsFlashing(false), 2000);
      
      prevValue.current = value;
      return () => clearTimeout(timer);
    }
  }, [value]);

  return (
    <div className={`transition-all duration-300 ${isFlashing ? 'animate-live-flash rounded-md ring-2 ring-green-500/20' : ''} ${className || ''}`}>
      {children}
    </div>
  );
};
