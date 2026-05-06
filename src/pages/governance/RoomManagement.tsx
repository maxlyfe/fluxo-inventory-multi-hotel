// src/pages/governance/RoomManagement.tsx
// Gestão de Categorias e UHs para hotéis sem Erbon

import React, { useState, useEffect, useCallback } from 'react';
import {
  LayoutGrid, Plus, Edit2, Trash2, Home, BedDouble,
  ChevronRight, Loader2, Save, X, AlertCircle
} from 'lucide-react';
import { useHotel } from '../../context/HotelContext';
import { useNotification } from '../../context/NotificationContext';
import { governanceService, RoomCategory, HotelRoom } from '../../lib/governanceService';
import Modal from '../../components/Modal';

export default function RoomManagement() {
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();

  const [categories, setCategories] = useState<RoomCategory[]>([]);
  const [rooms, setRooms] = useState<HotelRoom[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [isCatModalOpen, setIsCatModalOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<RoomCategory | null>(null);
  const [catName, setCatName] = useState('');

  const [isRoomModalOpen, setIsRoomModalOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<HotelRoom | null>(null);
  const [roomForm, setRoomForm] = useState({ name: '', floor: '', category_id: '' });

  const loadData = useCallback(async () => {
    if (!selectedHotel) return;
    setLoading(true);
    try {
      const [cats, rms] = await Promise.all([
        governanceService.fetchCategories(selectedHotel.id),
        governanceService.fetchLocalRooms(selectedHotel.id),
      ]);
      setCategories(cats);
      setRooms(rms);
    } catch (err: any) {
      addNotification('Erro ao carregar dados.', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedHotel, addNotification]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Categorias ───────────────────────────────────────────────────────────

  const handleSaveCat = async () => {
    if (!selectedHotel || !catName.trim()) return;
    try {
      await governanceService.upsertCategory(selectedHotel.id, catName.trim(), editingCat?.id);
      addNotification('Categoria salva com sucesso.', 'success');
      setIsCatModalOpen(false);
      loadData();
    } catch (err: any) {
      addNotification('Erro ao salvar categoria.', 'error');
    }
  };

  const handleDeleteCat = async (id: string) => {
    if (!window.confirm('Excluir esta categoria? UHs vinculadas ficarão sem categoria.')) return;
    try {
      await governanceService.deleteCategory(id);
      addNotification('Categoria excluída.', 'success');
      loadData();
    } catch (err: any) {
      addNotification('Erro ao excluir categoria.', 'error');
    }
  };

  // ── UHs ──────────────────────────────────────────────────────────────────

  const handleSaveRoom = async () => {
    if (!selectedHotel || !roomForm.name.trim()) return;
    try {
      await governanceService.upsertRoom({
        id: editingRoom?.id,
        hotel_id: selectedHotel.id,
        name: roomForm.name.trim(),
        floor: roomForm.floor ? parseInt(roomForm.floor, 10) : null,
        category_id: roomForm.category_id || null,
      });
      addNotification('UH salva com sucesso.', 'success');
      setIsRoomModalOpen(false);
      loadData();
    } catch (err: any) {
      addNotification('Erro ao salvar UH.', 'error');
    }
  };

  const handleDeleteRoom = async (id: string) => {
    if (!window.confirm('Excluir esta UH?')) return;
    try {
      await governanceService.deleteRoom(id);
      addNotification('UH excluída.', 'success');
      loadData();
    } catch (err: any) {
      addNotification('Erro ao excluir UH.', 'error');
    }
  };

  if (!selectedHotel) return null;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500 flex items-center justify-center shadow-lg shadow-indigo-200 dark:shadow-indigo-900/40">
              <Home className="h-5 w-5 text-white" />
            </div>
            Gestão de Unidades (UHs)
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 ml-[52px]">
            Configure as categorias e apartamentos para o hotel (Modo Manual)
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-indigo-500" /></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Coluna Categorias */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-widest flex items-center gap-2">
                <LayoutGrid className="w-4 h-4" /> Categorias
              </h2>
              <button
                onClick={() => { setEditingCat(null); setCatName(''); setIsCatModalOpen(true); }}
                className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
              {categories.length === 0 ? (
                <p className="p-8 text-center text-xs text-gray-400 italic">Nenhuma categoria.</p>
              ) : (
                <div className="divide-y divide-gray-50 dark:divide-gray-700">
                  {categories.map(cat => (
                    <div key={cat.id} className="flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 group transition-colors">
                      <span className="font-semibold text-sm text-gray-700 dark:text-gray-200">{cat.name}</span>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => { setEditingCat(cat); setCatName(cat.name); setIsCatModalOpen(true); }} className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg"><Edit2 className="w-3.5 h-3.5" /></button>
                        <button onClick={() => handleDeleteCat(cat.id)} className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Coluna UHs */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-widest flex items-center gap-2">
                <BedDouble className="w-4 h-4" /> Apartamentos ({rooms.length})
              </h2>
              <button
                onClick={() => { setEditingRoom(null); setRoomForm({ name: '', floor: '', category_id: '' }); setIsRoomModalOpen(true); }}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-xl hover:bg-indigo-700 shadow-sm transition-all"
              >
                <Plus className="w-4 h-4" /> Nova UH
              </button>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-900/50 text-[10px] uppercase font-bold text-gray-400 tracking-wider">
                    <th className="px-6 py-4">UH</th>
                    <th className="px-6 py-4">Andar</th>
                    <th className="px-6 py-4">Categoria</th>
                    <th className="px-6 py-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                  {rooms.length === 0 ? (
                    <tr><td colSpan={4} className="px-6 py-12 text-center text-gray-400 italic">Nenhum apartamento cadastrado.</td></tr>
                  ) : (
                    rooms.map(room => (
                      <tr key={room.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors group">
                        <td className="px-6 py-4 font-bold text-gray-900 dark:text-white">{room.name}</td>
                        <td className="px-6 py-4 text-gray-500 dark:text-gray-400">{room.floor ?? '—'}°</td>
                        <td className="px-6 py-4">
                          <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-[10px] font-bold text-gray-500 dark:text-gray-400">
                            {categories.find(c => c.id === room.category_id)?.name || 'Sem Categoria'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right opacity-0 group-hover:opacity-100 transition-opacity">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => { 
                              setEditingRoom(room); 
                              setRoomForm({ name: room.name, floor: String(room.floor || ''), category_id: room.category_id || '' }); 
                              setIsRoomModalOpen(true); 
                            }} className="p-2 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg"><Edit2 className="w-4 h-4" /></button>
                            <button onClick={() => handleDeleteRoom(room.id)} className="p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal Categoria */}
      <Modal isOpen={isCatModalOpen} onClose={() => setIsCatModalOpen(false)} title={editingCat ? 'Editar Categoria' : 'Nova Categoria'}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Nome da Categoria</label>
            <input type="text" value={catName} onChange={e => setCatName(e.target.value)} autoFocus className="w-full p-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setIsCatModalOpen(false)} className="px-4 py-2 text-sm text-gray-500 font-medium">Cancelar</button>
            <button onClick={handleSaveCat} className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-xl">Salvar</button>
          </div>
        </div>
      </Modal>

      {/* Modal UH */}
      <Modal isOpen={isRoomModalOpen} onClose={() => setIsRoomModalOpen(false)} title={editingRoom ? 'Editar Apartamento' : 'Novo Apartamento'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Número / Nome *</label>
              <input type="text" value={roomForm.name} onChange={e => setRoomForm({ ...roomForm, name: e.target.value })} autoFocus className="w-full p-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Andar</label>
              <input type="number" value={roomForm.floor} onChange={e => setRoomForm({ ...roomForm, floor: e.target.value })} className="w-full p-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Categoria</label>
            <select value={roomForm.category_id} onChange={e => setRoomForm({ ...roomForm, category_id: e.target.value })} className="w-full p-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500">
              <option value="">Selecione...</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <button onClick={() => setIsRoomModalOpen(false)} className="px-4 py-2 text-sm text-gray-500 font-medium">Cancelar</button>
            <button onClick={handleSaveRoom} className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-xl">Salvar Apartamento</button>
          </div>
        </div>
      </Modal>

    </div>
  );
}
