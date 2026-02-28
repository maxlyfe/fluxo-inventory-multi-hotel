import React from 'react';

interface LoadingIndicatorProps {
  size?: 'small' | 'medium' | 'large';
  fullScreen?: boolean;
  message?: string;
  className?: string; // Allow custom classes
}

/**
 * Componente reutilizável para exibir um indicador de carregamento.
 * Pode ser exibido inline, com mensagem ou como overlay de tela cheia.
 */
const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({
  size = 'medium',
  fullScreen = false,
  message,
  className = ''
}) => {
  const sizeClass = {
    small: 'h-4 w-4 border-2',
    medium: 'h-8 w-8 border-2',
    large: 'h-12 w-12 border-4' // Increased border for large
  };

  const spinner = (
    <div 
      className={`animate-spin rounded-full border-b-2 border-blue-600 ${sizeClass[size]}`}
      role="status"
      aria-live="polite"
      aria-label={message || 'Carregando...'}
    ></div>
  );

  if (fullScreen) {
    return (
      <div 
        className={`fixed inset-0 bg-gray-900/20 dark:bg-gray-900/50 backdrop-blur-sm flex justify-center items-center z-50 ${className}`}
        aria-modal="true"
        aria-labelledby="loading-message"
      >
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 flex flex-col items-center">
          {spinner}
          {message && (
            <p id="loading-message" className="mt-4 text-gray-700 dark:text-gray-300">{message}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-center justify-center ${className}`}>
      {spinner}
      {message && (
        <p className="ml-3 text-gray-700 dark:text-gray-300">{message}</p>
      )}
    </div>
  );
};

export default LoadingIndicator;
