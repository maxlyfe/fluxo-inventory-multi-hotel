// src/pages/PurchaseHistory.tsx
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useHotel } from '../context/HotelContext';
import { useNotification } from '../context/NotificationContext';
import { useAuth } from '../context/AuthContext';
import { Search, ChevronDown, ChevronUp, Edit2, Check, X, History, Trash2, AlertTriangle } from 'lucide-react';
import { format, parseISO } from 'date-fns';

interface PurchaseItem {
  id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  products: { id: string; name: string } | null;
}

interface Purchase {
  id: string;
  purchase_date: string;
  invoice_number: string | null;
  supplier: string | null;
  total_amount: number;
  notes: string | null;
  created_at: string;
  purchase_items: PurchaseItem[];
}

interface EditingState {
  purchaseId: string;
  purchase_date: string;
  notes: string;
  items: Record<string, { quantity: string; unit_price: string }>;
}

export default function PurchaseHistory() {
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();
  const { user } = useAuth();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<Purchase | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadPurchases = useCallback(async () => {
    if (!selectedHotel?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('purchases')
        .select(`
          id, purchase_date, invoice_number, supplier, total_amount, notes, created_at,
          purchase_items(id, product_id, quantity, unit_price, total_price, products:products(id, name))
        `)
        .eq('hotel_id', selectedHotel.id)
        .order('purchase_date', { ascending: false })
        .limit(200);

      if (error) throw error;
      setPurchases(data || []);
    } catch (err: any) {
      addNotification('Erro ao carregar compras: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedHotel?.id, addNotification]);

  useEffect(() => { loadPurchases(); }, [loadPurchases]);

  const filtered = search.trim()
    ? purchases.filter(p =>
        p.supplier?.toLowerCase().includes(search.toLowerCase()) ||
        p.invoice_number?.toLowerCase().includes(search.toLowerCase()) ||
        p.purchase_items.some(i => i.products?.name.toLowerCase().includes(search.toLowerCase()))
      )
    : purchases;

  function startEdit(p: Purchase) {
    const items: Record<string, { quantity: string; unit_price: string }> = {};
    p.purchase_items.forEach(i => {
      items[i.id] = { quantity: i.quantity.toString(), unit_price: i.unit_price.toString() };
    });
    setEditing({
      purchaseId: p.id,
      purchase_date: p.purchase_date,
      notes: p.notes || '',
      items,
    });
    setExpandedId(p.id);
  }

  async function handleSave() {
    if (!editing || !user) return;
    setSaving(true);
    try {
      const purchase = purchases.find(p => p.id === editing.purchaseId);
      if (!purchase) return;

      // Log and update purchase_date if changed
      if (editing.purchase_date !== purchase.purchase_date) {
        await supabase.from('purchase_edit_logs').insert({
          purchase_id: editing.purchaseId,
          field_changed: 'purchase_date',
          old_value: purchase.purchase_date,
          new_value: editing.purchase_date,
          changed_by: user.id,
        });
        await supabase.from('purchases').update({ purchase_date: editing.purchase_date }).eq('id', editing.purchaseId);
      }

      // Update items
      for (const item of purchase.purchase_items) {
        const editedItem = editing.items[item.id];
        if (!editedItem) continue;

        const newQty = parseFloat(editedItem.quantity.replace(',', '.')) || item.quantity;
        const newPrice = parseFloat(editedItem.unit_price.replace(',', '.')) || item.unit_price;
        const newTotal = newQty * newPrice;

        if (newQty !== item.quantity || newPrice !== item.unit_price) {
          if (newQty !== item.quantity) {
            await supabase.from('purchase_edit_logs').insert({
              purchase_id: editing.purchaseId, purchase_item_id: item.id,
              field_changed: 'quantity', old_value: item.quantity.toString(),
              new_value: newQty.toString(), changed_by: user.id,
            });
          }
          if (newPrice !== item.unit_price) {
            await supabase.from('purchase_edit_logs').insert({
              purchase_id: editing.purchaseId, purchase_item_id: item.id,
              field_changed: 'unit_price', old_value: item.unit_price.toString(),
              new_value: newPrice.toString(), changed_by: user.id,
            });
          }

          await supabase.from('purchase_items').update({
            quantity: newQty, unit_price: newPrice, total_price: newTotal,
          }).eq('id', item.id);
        }
      }

      // Recalculate
      await supabase.rpc('recalculate_purchase_impact', { p_purchase_id: editing.purchaseId });

      addNotification('Compra atualizada com sucesso!', 'success');
      setEditing(null);
      loadPurchases();
    } catch (err: any) {
      addNotification('Erro ao salvar: ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(purchase: Purchase) {
    setDeleting(true);
    try {
      const { error } = await supabase.rpc('delete_purchase_with_reversal', {
        p_purchase_id: purchase.id,
      });
      if (error) throw error;
      addNotification(
        `Compra de "${purchase.supplier || 'S/N'}" excluída e estoque estornado.`,
        'success'
      );
      setDeleteConfirm(null);
      loadPurchases();
    } catch (err: any) {
      addNotification('Erro ao excluir compra: ' + err.message, 'error');
    } finally {
      setDeleting(false);
    }
  }

  if (!selectedHotel) {
    return <div className="flex items-center justify-center h-64"><p className="text-gray-500 dark:text-gray-400">Selecione um hotel.</p></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
          <History className="w-7 h-7 text-purple-600" />
          Histórico de Compras
        </h1>
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Buscar por fornecedor, NF ou produto..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
          />
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 text-center text-gray-500 dark:text-gray-400">
          {search ? 'Nenhuma compra encontrada' : 'Nenhuma compra registrada'}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(p => {
            const isExpanded = expandedId === p.id;
            const isEditing = editing?.purchaseId === p.id;

            return (
              <div key={p.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="p-4 flex justify-between items-center cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  onClick={() => setExpandedId(isExpanded ? null : p.id)}>
                  <div className="flex items-center gap-4">
                    {isExpanded ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
                    <div>
                      <p className="text-sm font-semibold text-gray-800 dark:text-white">
                        {p.supplier || 'Sem fornecedor'}
                        {p.invoice_number && <span className="ml-2 text-xs text-gray-400">NF: {p.invoice_number}</span>}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {format(parseISO(p.purchase_date), 'dd/MM/yyyy')} · {p.purchase_items.length} ite{p.purchase_items.length !== 1 ? 'ns' : 'm'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3" onClick={e => e.stopPropagation()}>
                    <span className="text-sm font-bold text-green-600 dark:text-green-400">
                      R$ {Number(p.total_amount).toFixed(2)}
                    </span>
                    {!isEditing && (
                      <>
                        <button onClick={() => startEdit(p)}
                          className="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                          title="Editar compra">
                          <Edit2 size={16} />
                        </button>
                        <button onClick={() => setDeleteConfirm(p)}
                          className="p-1.5 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                          title="Excluir compra">
                          <Trash2 size={16} />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-900">
                    {isEditing && (
                      <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Data da Compra</label>
                          <input type="date" value={editing!.purchase_date}
                            onChange={e => setEditing({ ...editing!, purchase_date: e.target.value })}
                            className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Observações</label>
                          <input type="text" value={editing!.notes}
                            onChange={e => setEditing({ ...editing!, notes: e.target.value })}
                            className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                          />
                        </div>
                      </div>
                    )}

                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-500 dark:text-gray-400 text-xs">
                          <th className="pb-2">Produto</th>
                          <th className="pb-2 text-right">Qtd</th>
                          <th className="pb-2 text-right">Preço Unit.</th>
                          <th className="pb-2 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.purchase_items.map(item => (
                          <tr key={item.id} className="border-t border-gray-200 dark:border-gray-700">
                            <td className="py-2 text-gray-900 dark:text-gray-100">{item.products?.name || 'Produto removido'}</td>
                            <td className="py-2 text-right">
                              {isEditing ? (
                                <input type="text" inputMode="decimal"
                                  value={editing!.items[item.id]?.quantity || ''}
                                  onChange={e => setEditing({
                                    ...editing!,
                                    items: { ...editing!.items, [item.id]: { ...editing!.items[item.id], quantity: e.target.value } }
                                  })}
                                  className="w-20 px-2 py-1 text-right border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                                />
                              ) : (
                                <span className="text-gray-600 dark:text-gray-400 font-mono">{item.quantity}</span>
                              )}
                            </td>
                            <td className="py-2 text-right">
                              {isEditing ? (
                                <input type="text" inputMode="decimal"
                                  value={editing!.items[item.id]?.unit_price || ''}
                                  onChange={e => setEditing({
                                    ...editing!,
                                    items: { ...editing!.items, [item.id]: { ...editing!.items[item.id], unit_price: e.target.value } }
                                  })}
                                  className="w-24 px-2 py-1 text-right border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                                />
                              ) : (
                                <span className="text-gray-600 dark:text-gray-400 font-mono">R$ {Number(item.unit_price).toFixed(2)}</span>
                              )}
                            </td>
                            <td className="py-2 text-right font-medium text-gray-900 dark:text-gray-100 font-mono">
                              R$ {isEditing
                                ? ((parseFloat((editing!.items[item.id]?.quantity || '0').replace(',', '.')) || 0) *
                                   (parseFloat((editing!.items[item.id]?.unit_price || '0').replace(',', '.')) || 0)).toFixed(2)
                                : Number(item.total_price).toFixed(2)
                              }
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {isEditing && (
                      <div className="flex gap-2 mt-4">
                        <button onClick={handleSave} disabled={saving}
                          className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors text-sm disabled:opacity-50">
                          <Check size={16} /> {saving ? 'Salvando...' : 'Salvar'}
                        </button>
                        <button onClick={() => setEditing(null)}
                          className="flex items-center gap-2 bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600 transition-colors text-sm">
                          <X size={16} /> Cancelar
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {/* Modal de confirmação de exclusão */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-md p-6">
            <div className="flex items-start gap-4 mb-5">
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Excluir compra?</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Esta ação é irreversível. A compra de{' '}
                  <strong className="text-gray-700 dark:text-gray-300">{deleteConfirm.supplier || 'fornecedor'}</strong>
                  {deleteConfirm.invoice_number && <> (NF: {deleteConfirm.invoice_number})</>}{' '}
                  será excluída e o estoque dos {deleteConfirm.purchase_items.length} produto(s) será estornado automaticamente.
                </p>
              </div>
            </div>

            {/* Itens afetados */}
            <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/40 rounded-xl p-3 mb-5 max-h-40 overflow-y-auto">
              <p className="text-[10px] uppercase font-semibold text-red-500 mb-2 tracking-wide">Produtos com estoque estornado</p>
              <ul className="space-y-1">
                {deleteConfirm.purchase_items.map(item => (
                  <li key={item.id} className="flex justify-between text-xs text-gray-700 dark:text-gray-300">
                    <span>{item.products?.name || 'Produto removido'}</span>
                    <span className="font-mono text-red-600 dark:text-red-400">−{item.quantity}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition disabled:opacity-50">
                Cancelar
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                disabled={deleting}
                className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-sm transition disabled:opacity-50">
                {deleting ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                ) : (
                  <Trash2 size={16} />
                )}
                {deleting ? 'Excluindo...' : 'Excluir e estornar estoque'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
