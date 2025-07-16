import React, { useState } from 'react';
import { useHotel } from '../context/HotelContext';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// Importe todos os seus componentes de relatório
import StockControlReport from '../components/reports/StockControlReport';
import UtilitiesReport from '../components/reports/UtilitiesReport';
import LaundryReport from '../components/reports/LaundryReport';
import SurplusReport from '../components/reports/SurplusReport';
import KitchenLossesReport from '../components/reports/KitchenLossesReport';
import ExpensesGuestReport from '../components/reports/ExpensesGuestReport';

// Define os tipos para os relatórios para manter o código limpo
type ReportKey = 'stockControl' | 'utilities' | 'laundry' | 'surplus' | 'kitchenLosses' | 'expensesGuest';

const reports: { key: ReportKey; name: string }[] = [
  { key: 'stockControl', name: 'Controle de Stock/Vendas' },
  { key: 'utilities', name: 'Enel / Prolagos' },
  { key: 'expensesGuest', name: 'Gastos x Hóspede' },
  { key: 'laundry', name: 'Lavanderia' },
  { key: 'surplus', name: 'Sobrantes' },
  { key: 'kitchenLosses', name: 'Perdas Cozinha' },
];

const ReportsPage = () => {
  const navigate = useNavigate();
  const { selectedHotel } = useHotel();
  // --- CORREÇÃO: O estado inicial agora é 'null' para não carregar nada ---
  const [activeReport, setActiveReport] = useState<ReportKey | null>(null); 

  const renderActiveReport = () => {
    // Se nenhum relatório estiver ativo, mostra uma mensagem
    if (!activeReport) {
        return (
            <div className="text-center py-16">
                <h3 className="text-xl font-semibold text-gray-700 dark:text-gray-200">Bem-vindo à Central de Relatórios</h3>
                <p className="mt-2 text-gray-500 dark:text-gray-400">Por favor, selecione um relatório na navegação acima para começar.</p>
            </div>
        )
    }

    switch (activeReport) {
      case 'stockControl':
        return <StockControlReport />;
      case 'utilities':
        return <UtilitiesReport />;
      case 'laundry':
        return <LaundryReport />;
      case 'surplus':
        return <SurplusReport />;
      case 'kitchenLosses':
        return <KitchenLossesReport />;
      case 'expensesGuest':
        return <ExpensesGuestReport />;
      default:
        return <p>Selecione um relatório.</p>;
    }
  };

  if (!selectedHotel) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-150px)] p-4 text-center">
        <AlertTriangle className="w-16 h-16 text-yellow-500 mb-4" />
        <h2 className="text-2xl font-semibold text-gray-700 dark:text-gray-300 mb-2">Nenhum Hotel Selecionado</h2>
        <p className="text-gray-500 dark:text-gray-400">Por favor, selecione um hotel para ver os relatórios.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 md:p-6 bg-gray-50 dark:bg-gray-900 min-h-screen">
      <div className="flex items-center justify-between mb-6">
        <button onClick={() => navigate(-1)} className="flex items-center text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white">
          <ArrowLeft className="w-5 h-5 mr-2" />
          Voltar
        </button>
        <h1 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white">
          Central de Relatórios - {selectedHotel.name}
        </h1>
        <div className="w-8"></div> 
      </div>

      {/* Navegação por Abas/Botões Horizontais */}
      <div className="mb-8 border-b border-gray-300 dark:border-gray-700">
        <nav className="flex flex-wrap -mb-px gap-x-6">
          {reports.map((report) => (
            <button
              key={report.key}
              onClick={() => setActiveReport(report.key)}
              className={`px-3 py-3 text-sm font-medium transition-colors duration-200 ease-in-out
                ${
                  activeReport === report.key
                    ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-b-2 border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white'
                }
              `}
            >
              {report.name}
            </button>
          ))}
        </nav>
      </div>

      {/* Área de Renderização do Relatório Ativo */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg min-h-[400px]">
        {renderActiveReport()}
      </div>
    </div>
  );
};

export default ReportsPage;