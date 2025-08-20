// src/components/Chatbot.tsx

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Sparkles, X, Send, Bot, User, GripVertical } from 'lucide-react';
import classNames from 'classnames';

interface Message {
  text: string;
  sender: 'user' | 'bot';
}

const FUNCTION_URL = 'https://bnmyflgyrlskhljrbyfc.supabase.co/functions/v1/ask-chatbot';

export default function Chatbot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // --- LÓGICA DE ARRASTAR E SOLTAR ---
  const [position, setPosition] = useState({ x: window.innerWidth - 350, y: window.innerHeight - 520 });
  const chatWindowRef = useRef<HTMLDivElement>(null);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const isDragging = useRef(false);
  // ------------------------------------
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const userMessage = inputValue.trim();
    if (!userMessage) return;

    setMessages((prev) => [...prev, { text: userMessage, sender: 'user' }]);
    setInputValue('');
    setIsLoading(true);

    try {
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY },
        body: JSON.stringify({ query: userMessage }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'A resposta da rede não foi OK.');
      setMessages((prev) => [...prev, { text: result.answer, sender: 'bot' }]);
    } catch (error) {
      console.error('Erro ao buscar resposta:', error);
      const errorMessage = error instanceof Error ? error.message : "Desculpe, não consegui me conectar.";
      setMessages((prev) => [...prev, { text: errorMessage, sender: 'bot' }]);
    } finally {
      setIsLoading(false);
    }
  };

  // --- FUNÇÕES DE ARRASTAR E SOLTAR ---
  const handleDragStart = useCallback((clientX: number, clientY: number) => {
    isDragging.current = true;
    if (chatWindowRef.current) {
      dragStartPos.current = {
        x: clientX - chatWindowRef.current.offsetLeft,
        y: clientY - chatWindowRef.current.offsetTop,
      };
    }
  }, []);

  const handleDragMove = useCallback((clientX: number, clientY: number) => {
    if (!isDragging.current) return;
    let newX = clientX - dragStartPos.current.x;
    let newY = clientY - dragStartPos.current.y;

    // Limita o movimento para dentro da tela
    newX = Math.max(0, Math.min(newX, window.innerWidth - (chatWindowRef.current?.offsetWidth || 0)));
    newY = Math.max(0, Math.min(newY, window.innerHeight - (chatWindowRef.current?.offsetHeight || 0)));

    setPosition({ x: newX, y: newY });
  }, []);

  const handleDragEnd = useCallback(() => {
    isDragging.current = false;
  }, []);

  // Adiciona e remove os listeners globais para um arrastar mais suave
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => handleDragMove(e.clientX, e.clientY);
    const onTouchMove = (e: TouchEvent) => handleDragMove(e.touches[0].clientX, e.touches[0].clientY);
    const onMouseUp = () => handleDragEnd();
    const onTouchEnd = () => handleDragEnd();

    if (isDragging.current) {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('touchmove', onTouchMove);
      window.addEventListener('mouseup', onMouseUp);
      window.addEventListener('touchend', onTouchEnd);
    }

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [handleDragMove, handleDragEnd]);
  // ------------------------------------

  return (
    <>
      {/* Janela do Chat (agora com posição absoluta controlada pelo estado) */}
      {isOpen && (
        <div
          ref={chatWindowRef}
          className="fixed bg-white dark:bg-gray-800 w-80 h-[28rem] rounded-lg shadow-xl flex flex-col z-50"
          style={{ top: `${position.y}px`, left: `${position.x}px` }}
        >
          {/* Cabeçalho com a "alça" para arrastar */}
          <div
            className="bg-gray-800 dark:bg-gray-900 text-white p-3 rounded-t-lg flex justify-between items-center cursor-move"
            onMouseDown={(e) => handleDragStart(e.clientX, e.clientY)}
            onTouchStart={(e) => handleDragStart(e.touches[0].clientX, e.touches[0].clientY)}
          >
            <div className="flex items-center gap-2">
              <GripVertical size={20} className="text-gray-500" />
              <h3 className="font-bold">Assistente Virtual</h3>
            </div>
            <button onClick={() => setIsOpen(false)} className="hover:bg-gray-700 p-1 rounded-full">
              <X size={20} />
            </button>
          </div>

          {/* Corpo e Input (agora com o código corrigido) */}
          <div className="flex-1 p-4 overflow-y-auto bg-gray-50 dark:bg-gray-700">
            {messages.length === 0 && (
              <div className="flex items-start gap-2.5 mb-4">
                <div className="bg-gray-800 dark:bg-gray-900 text-white p-2 rounded-full"><Bot size={20}/></div>
                <div className="p-3 rounded-lg max-w-xs bg-gray-200 dark:bg-gray-600 dark:text-gray-200 text-gray-800 rounded-bl-none">
                  <p className="text-sm">Olá! Como posso ajudar com o sistema?</p>
                </div>
              </div>
            )}
            {messages.map((msg, index) => (
              <div key={index} className={classNames("flex items-start gap-2.5 mb-4", { 'justify-end': msg.sender === 'user' })}>
                {msg.sender === 'bot' && <div className="bg-gray-800 dark:bg-gray-900 text-white p-2 rounded-full"><Bot size={20}/></div>}
                <div className={classNames("p-3 rounded-lg max-w-xs", {
                  'bg-blue-600 text-white rounded-br-none': msg.sender === 'user',
                  'bg-gray-200 dark:bg-gray-600 dark:text-gray-200 text-gray-800 rounded-bl-none': msg.sender === 'bot',
                })}>
                  <p className="text-sm">{msg.text}</p>
                </div>
                {msg.sender === 'user' && <div className="bg-blue-600 text-white p-2 rounded-full"><User size={20}/></div>}
              </div>
            ))}
            {isLoading && <p className="text-sm text-gray-500 dark:text-gray-400">O assistente está pensando...</p>}
            <div ref={messagesEndRef} />
          </div>
          <div className="border-t border-gray-200 dark:border-gray-600 p-2 bg-white dark:bg-gray-800 rounded-b-lg">
            <form onSubmit={handleSubmit} className="flex items-center">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Digite sua dúvida..."
                className="w-full px-3 py-2 border rounded-l-md focus:outline-none focus:ring-2 focus:ring-blue-600 bg-gray-50 dark:bg-gray-700 dark:text-white dark:border-gray-600"
                disabled={isLoading}
              />
              <button type="submit" className="bg-gray-800 dark:bg-gray-900 text-white px-4 py-2 rounded-r-md hover:bg-gray-700 dark:hover:bg-gray-600 disabled:bg-gray-400" disabled={isLoading}>
                <Send size={20}/>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Botão flutuante para abrir o chat (posição fixa) */}
      <div className="fixed bottom-4 right-4 z-40">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={classNames(
            "text-white p-4 rounded-full shadow-lg transition-all duration-300 ease-in-out bg-gradient-to-br from-blue-600 to-indigo-700 hover:from-blue-700 hover:to-indigo-800 hover:scale-110",
            { 'transform rotate-180 scale-0 opacity-0': isOpen }
          )}
          aria-label="Abrir assistente de IA"
        >
          <Sparkles size={28} />
        </button>
      </div>
    </>
  );
}
