// src/pages/portal/MyDocuments.tsx
// Documentos do colaborador: entregas de uniforme, termos de responsabilidade

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useHotel } from '../../context/HotelContext';
import { format, parseISO, differenceInMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Shirt, FileText, AlertTriangle, Loader2, ChevronDown, ChevronUp,
  Package, Calendar, Clock,
} from 'lucide-react';

interface UniformDelivery {
  id: string;
  delivery_date: string;
  items: { item: string; qty: number; size: string }[];
  notes: string | null;
  doc_generated: boolean;
  doc_url: string | null;
  registered_at: string;
}

interface Employee {
  id: string;
  name: string;
  role: string;
  sector: string;
  shirt_size: string | null;
  pants_size: string | null;
  shoe_size: string | null;
  admission_date: string;
}

export default function MyDocuments() {
  const { user } = useAuth();
  const { selectedHotel } = useHotel();

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [deliveries, setDeliveries] = useState<UniformDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id || !selectedHotel?.id) return;
    loadData();
  }, [user?.id, selectedHotel?.id]);

  async function loadData() {
    setLoading(true);
    try {
      const { data: emp } = await supabase
        .from('employees')
        .select('id, name, role, sector, shirt_size, pants_size, shoe_size, admission_date')
        .eq('hotel_id', selectedHotel!.id)
        .eq('user_id', user!.id)
        .eq('status', 'active')
        .maybeSingle();

      if (emp) {
        setEmployee(emp);
        const { data: uniformData } = await supabase
          .from('uniform_deliveries')
          .select('*')
          .eq('employee_id', emp.id)
          .order('delivery_date', { ascending: false });
        setDeliveries(uniformData || []);
      }
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-2">Conta não vinculada</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Sua conta de usuário não está vinculada a um colaborador.
        </p>
      </div>
    );
  }

  const lastDelivery = deliveries[0];
  const monthsSinceLastDelivery = lastDelivery
    ? differenceInMonths(new Date(), parseISO(lastDelivery.delivery_date))
    : null;
  const needsRenewal = monthsSinceLastDelivery !== null && monthsSinceLastDelivery >= 6;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
          <FileText className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Meus Documentos</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{employee.name} · {employee.sector}</p>
        </div>
      </div>

      {/* Tamanhos registrados */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-white mb-3">Meus Tamanhos</h3>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Camisa', value: employee.shirt_size },
            { label: 'Calça', value: employee.pants_size },
            { label: 'Calçado', value: employee.shoe_size },
          ].map(item => (
            <div key={item.label} className="text-center p-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <p className="text-xs text-gray-500 dark:text-gray-400">{item.label}</p>
              <p className="text-sm font-semibold text-gray-800 dark:text-white mt-0.5">
                {item.value || '—'}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Renewal alert */}
      {needsRenewal && (
        <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3 mb-4">
          <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
          <p className="text-sm text-amber-700 dark:text-amber-300">
            Última entrega há {monthsSinceLastDelivery} meses. Fale com o DP sobre renovação de uniforme.
          </p>
        </div>
      )}

      {/* Deliveries */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-white">
          Entregas de Uniforme ({deliveries.length})
        </h3>

        {deliveries.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 text-center">
            <Shirt className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
            <p className="text-sm text-gray-500 dark:text-gray-400">Nenhuma entrega registrada</p>
          </div>
        ) : (
          deliveries.map(delivery => {
            const isExpanded = expandedId === delivery.id;
            return (
              <div
                key={delivery.id}
                className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden"
              >
                <button
                  onClick={() => setExpandedId(isExpanded ? null : delivery.id)}
                  className="w-full flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                      <Package className="w-4 h-4 text-green-600 dark:text-green-400" />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-medium text-gray-800 dark:text-white">
                        {delivery.items.length} {delivery.items.length === 1 ? 'item' : 'itens'}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {format(parseISO(delivery.delivery_date), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
                      </p>
                    </div>
                  </div>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </button>

                {isExpanded && (
                  <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-3 bg-gray-50 dark:bg-gray-900">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-gray-500 dark:text-gray-400 text-xs">
                          <th className="text-left pb-2">Item</th>
                          <th className="text-center pb-2">Tam.</th>
                          <th className="text-center pb-2">Qtd.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {delivery.items.map((item, idx) => (
                          <tr key={idx} className="border-t border-gray-200 dark:border-gray-700">
                            <td className="py-1.5 text-gray-800 dark:text-white">{item.item}</td>
                            <td className="py-1.5 text-center text-gray-600 dark:text-gray-300">{item.size || '—'}</td>
                            <td className="py-1.5 text-center text-gray-600 dark:text-gray-300">{item.qty}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {delivery.notes && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                        {delivery.notes}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
