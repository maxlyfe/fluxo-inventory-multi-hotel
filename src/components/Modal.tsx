// Importa o React e o ícone 'X' da biblioteca lucide-react.
import React from 'react';
import { X } from 'lucide-react';

// Interface de propriedades do modal.
interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  // --- ALTERAÇÃO: Adicionadas mais opções de tamanho, até '7xl' ---
  // Isso nos dá mais flexibilidade para modais grandes como o de relatórios.
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | '6xl' | '7xl';
}

/**
 * Componente de Modal genérico e reutilizável.
 * @param size - O tamanho (largura máxima) do modal. O padrão é 'lg'.
 */
const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, size = 'lg' }) => {
  // Se o modal não estiver aberto, não renderiza nada.
  if (!isOpen) return null;

  // Mapeamento de tamanhos para classes do Tailwind CSS.
  const sizeClass = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
    '4xl': 'max-w-4xl',
    '5xl': 'max-w-5xl',
    // Novas classes de tamanho para modais maiores.
    '6xl': 'max-w-6xl',
    '7xl': 'max-w-7xl',
  }[size];

  return (
    // Backdrop escuro que cobre a tela inteira.
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center p-4"
      onClick={onClose} // Fecha o modal ao clicar no fundo.
    >
      {/* Container principal do modal. */}
      <div 
        // Aplica a classe de tamanho dinamicamente.
        className={`bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full ${sizeClass} mx-4 max-h-[90vh] flex flex-col`}
        onClick={(e) => e.stopPropagation()} // Impede que o clique dentro do modal o feche.
      >
        {/* Cabeçalho do Modal */}
        <div className="flex justify-between items-center p-4 border-b dark:border-gray-700 flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white">{title}</h2>
          <button 
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Corpo do Modal (conteúdo) */}
        <div className="p-4 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
};

export default Modal;
