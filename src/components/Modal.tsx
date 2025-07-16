import React from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center p-4"
      onClick={onClose} // Close on clicking the backdrop
    >
      <div 
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col" // Adjusted max-width, added max-height, flex-col
        onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside the modal content
      >
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b dark:border-gray-700 flex-shrink-0"> {/* Added flex-shrink-0 */}
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white">{title}</h2>
          <button 
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body - Added overflow */}
        <div className="p-4 overflow-y-auto"> {/* Added padding and overflow */}
          {children}
        </div>
      </div>
    </div>
  );
};

export default Modal;

