// src/pages/dp/DPEmployeeDetail.tsx
// Ficha completa do colaborador — placeholder funcional
// Será expandido no próximo passo com uniformes, histórico e termo PDF

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { ArrowLeft, Loader2, AlertTriangle, User } from 'lucide-react';

interface Employee {
  id: string; name: string; role: string; sector: string;
  status: string; admission_date: string; phone: string | null;
  email: string | null; cpf: string | null;
  hotels?: { name: string };
}

export default function DPEmployeeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    if (!id) return;
    supabase
      .from('employees')
      .select('*, hotels:hotel_id(name)')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (!error && data) setEmployee(data as Employee);
        setLoading(false);
      });
  }, [id]);

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
    </div>
  );

  if (!employee) return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-3 text-gray-400">
      <AlertTriangle className="h-10 w-10 opacity-30" />
      <p className="text-sm">Colaborador não encontrado.</p>
      <button onClick={() => navigate('/personnel-department')} className="text-blue-500 hover:underline text-sm">Voltar</button>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
      <button onClick={() => navigate('/personnel-department')}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-blue-600 transition-colors mb-6">
        <ArrowLeft className="h-4 w-4" />Voltar ao DP
      </button>

      <div className="bg-white dark:bg-gray-800 rounded-3xl border border-gray-100 dark:border-gray-700 p-6 shadow-sm">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center text-white text-xl font-bold shadow-sm">
            {employee.name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase()}
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">{employee.name}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">{employee.role} · {employee.sector}</p>
            {(employee.hotels as any)?.name && (
              <p className="text-xs text-gray-400 mt-0.5">{(employee.hotels as any).name}</p>
            )}
          </div>
        </div>

        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl p-4 text-center">
          <User className="h-8 w-8 text-blue-400 mx-auto mb-2" />
          <p className="text-sm font-semibold text-blue-700 dark:text-blue-300">Ficha completa em desenvolvimento</p>
          <p className="text-xs text-blue-500 dark:text-blue-400 mt-1">
            Uniformes, histórico de entregas e emissão de termo estarão disponíveis no próximo passo.
          </p>
        </div>
      </div>
    </div>
  );
}