// Importações de bibliotecas e componentes.
import React from 'react';
import { UsersRound } from 'lucide-react';
// Importa o componente que conterá a lógica e a tabela do relatório.
import ExperienceContractControl from '../components/personnel/ExperienceContractControl';

/**
 * Componente da página principal do Departamento Pessoal.
 * Atua como um container para os diferentes relatórios e funcionalidades desta seção.
 */
const PersonnelDepartmentPage: React.FC = () => {
  return (
    // Container principal com espaçamento e layout responsivo.
    <div className="container mx-auto p-4 md:p-6">
      {/* Cabeçalho da página */}
      <div className="flex items-center mb-6">
        <UsersRound className="h-8 w-8 text-blue-600 dark:text-blue-400 mr-3" />
        <h1 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white">
          Departamento Pessoal
        </h1>
      </div>

      {/* Container para o relatório específico. */}
      {/* O fundo branco e a sombra ajudam a destacar o conteúdo. */}
      <div className="bg-white dark:bg-gray-800 p-4 sm:p-6 rounded-lg shadow-lg">
        {/* Renderiza o componente do relatório de Contrato de Experiência. */}
        {/* No futuro, você pode adicionar um sistema de abas aqui para alternar entre diferentes relatórios do DP. */}
        <ExperienceContractControl />
      </div>
    </div>
  );
};

export default PersonnelDepartmentPage;
