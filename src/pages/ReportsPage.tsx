// Importa o React e hooks necessários do React e React Router.
import React, { useState } from 'react';
import { useHotel } from '../context/HotelContext';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// Importa os componentes de cada relatório específico.
import WeeklyReconciliationReport from '../components/reports/WeeklyReconciliationReport';
import UtilitiesReport from '../components/reports/UtilitiesReport';
import LaundryReport from '../components/reports/LaundryReport';
import SurplusReport from '../components/reports/SurplusReport';
import KitchenLossesReport from '../components/reports/KitchenLossesReport'; // Nosso novo relatório
import ExpensesGuestReport from '../components/reports/ExpensesGuestReport';
import StarredItemsReportModal from '../components/reports/StarredItemsReportModal'; // Mantido como no seu arquivo
import { getStarredItemsReport, StarredItemReportData } from '../lib/reportsService'; // Mantido como no seu arquivo

// Define um tipo para as chaves de cada relatório, garantindo consistência.
// A chave 'kitchenLosses' corresponde ao novo relatório.
type ReportKey = 'reconciliation' | 'utilities' | 'laundry' | 'surplus' | 'kitchenLosses' | 'expensesGuest';

// Array de configuração para a navegação dos relatórios.
// Cada objeto define a chave e o nome que aparecerá na aba.
const reports: { key: ReportKey; name: string }[] = [
  { key: 'reconciliation', name: 'Reconciliação Semanal' },
  { key: 'utilities', name: 'Enel / Prolagos' },
  { key: 'expensesGuest', name: 'Gastos x Hóspede' },
  { key: 'laundry', name: 'Lavanderia' },
  { key: 'surplus', name: 'Sobrantes' },
  { key: 'kitchenLosses', name: 'Perdas Cozinha' }, // Novo relatório adicionado aqui
];

// Componente principal da página de relatórios.
const ReportsPage = () => {
  // Hooks para navegação e acesso ao contexto do hotel selecionado.
  const navigate = useNavigate();
  const { selectedHotel } = useHotel();
  
  // Estado para controlar qual relatório está ativo (sendo exibido).
  const [activeReport, setActiveReport] = useState<ReportKey | null>(null);

  // Estados para o modal de Itens Principais (mantidos conforme seu código original).
  const [showStarredReportModal, setShowStarredReportModal] = useState(false);
  const [starredReportData, setStarredReportData] = useState<StarredItemReportData[]>([]);
  const [loadingStarred, setLoadingStarred] = useState(false);

  // Função para buscar os dados do relatório de itens principais (mantida).
  const handleOpenStarredReport = async () => {
    if (!selectedHotel) return;
    setLoadingStarred(true);
    setShowStarredReportModal(true);
    const { data, error } = await getStarredItemsReport(selectedHotel.id);
    if (error) {
      console.error(error);
    } else {
      setStarredReportData(data || []);
    }
    setLoadingStarred(false);
  };

  /**
   * Renderiza o componente de relatório ativo com base na seleção do usuário.
   * Utiliza um switch para determinar qual componente mostrar.
   */
  const renderActiveReport = () => {
    // Se nenhum relatório estiver selecionado, exibe uma mensagem de boas-vindas.
    if (!activeReport) {
        return (
            <div className="text-center py-16">
                <h3 className="text-xl font-semibold text-gray-700 dark:text-gray-200">Bem-vindo à Central de Relatórios</h3>
                <p className="mt-2 text-gray-500 dark:text-gray-400">Por favor, selecione um relatório na navegação acima para começar.</p>
            </div>
        )
    }

    // Com base no 'activeReport', renderiza o componente correspondente.
    switch (activeReport) {
      case 'reconciliation':
        return <WeeklyReconciliationReport />;
      case 'utilities':
        return <UtilitiesReport />;
      case 'laundry':
        return <LaundryReport />;
      case 'surplus':
        return <SurplusReport />;
      case 'kitchenLosses': // Caso para o nosso novo relatório.
        return <KitchenLossesReport />;
      case 'expensesGuest':
        return <ExpensesGuestReport />;
      default:
        return <p>Selecione um relatório.</p>;
    }
  };

  // Se nenhum hotel estiver selecionado, exibe um aviso em tela cheia.
  if (!selectedHotel) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-150px)] p-4 text-center">
        <AlertTriangle className="w-16 h-16 text-yellow-500 mb-4" />
        <h2 className="text-2xl font-semibold text-gray-700 dark:text-gray-300 mb-2">Nenhum Hotel Selecionado</h2>
        <p className="text-gray-500 dark:text-gray-400">Por favor, selecione um hotel para ver os relatórios.</p>
      </div>
    );
  }

  // Renderização principal do componente.
  return (
    <div className="container mx-auto p-4 md:p-6 bg-gray-50 dark:bg-gray-900 min-h-screen">
      <div className="flex items-center justify-between mb-6">
        <button onClick={() => navigate(-1)} className="flex items-center text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white">
          <ArrowLeft className="w-5 h-5 mr-2" />
          Voltar
        </button>
        <h1 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white text-center">
          Central de Relatórios
        </h1>
        {/* Botão de Itens Principais mantido. */}
        <button
          onClick={handleOpenStarredReport}
          className="flex items-center px-4 py-2 bg-yellow-500 text-white rounded-md hover:bg-yellow-600 transition-colors text-sm"
        >
          {/* O ícone de estrela foi removido do seu código original, então o removi daqui também para manter a consistência. */}
          Principais Itens
        </button>
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

      {/* Renderização do modal de relatório de itens principais (mantido). */}
      <StarredItemsReportModal
        isOpen={showStarredReportModal}
        onClose={() => setShowStarredReportModal(false)}
        reportData={starredReportData}
        loading={loadingStarred}
      />
    </div>
  );
};

export default ReportsPage;
