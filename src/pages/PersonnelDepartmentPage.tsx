// src/pages/PersonnelDepartmentPage.tsx
import React, { useState } from 'react';
import { UsersRound, Users, CalendarDays, Gift, Cake, Package } from 'lucide-react';
import DPEmployees from './dp/DPEmployees';
import DPSchedule from './dp/DPSchedule';
import DPBirthdays from './dp/DPBirthdays';
import DPBaskets from './dp/DPBaskets';

type MainTab    = 'employees' | 'schedule' | 'benefits';
type BenefitTab = 'birthdays' | 'baskets';

const MAIN_TABS = [
  { id: 'employees' as MainTab, label: 'Colaboradores', icon: Users        },
  { id: 'schedule'  as MainTab, label: 'Escala',        icon: CalendarDays },
  { id: 'benefits'  as MainTab, label: 'Benefícios',    icon: Gift         },
];

const BENEFIT_TABS = [
  { id: 'birthdays' as BenefitTab, label: 'Aniversários', icon: Cake,    activeClass: 'bg-pink-500 border-pink-500'    },
  { id: 'baskets'   as BenefitTab, label: 'Cestas',       icon: Package, activeClass: 'bg-emerald-500 border-emerald-500' },
];

const PersonnelDepartmentPage: React.FC = () => {
  const [mainTab,    setMainTab]    = useState<MainTab>('employees');
  const [benefitTab, setBenefitTab] = useState<BenefitTab>('birthdays');

  return (
    <div className="container mx-auto p-4 md:p-6">

      {/* Header */}
      <div className="flex items-center mb-6">
        <UsersRound className="h-8 w-8 text-blue-600 dark:text-blue-400 mr-3 flex-shrink-0" />
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white">
            Departamento Pessoal
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Gestão de colaboradores, escalas e contratos
          </p>
        </div>
      </div>

      {/* Abas principais */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-2xl mb-6 overflow-x-auto">
        {MAIN_TABS.map(tab => {
          const Icon   = tab.icon;
          const active = mainTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setMainTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all whitespace-nowrap flex-1 justify-center ${
                active
                  ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Conteúdo */}
      {mainTab === 'employees' && <DPEmployees />}
      {mainTab === 'schedule'  && <DPSchedule />}

      {mainTab === 'benefits' && (
        <div>
          {/* Sub-abas de Benefícios */}
          <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
            {BENEFIT_TABS.map(tab => {
              const Icon   = tab.icon;
              const active = benefitTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setBenefitTab(tab.id)}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all border whitespace-nowrap ${
                    active
                      ? `${tab.activeClass} text-white shadow-md`
                      : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-gray-300'
                  }`}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {benefitTab === 'birthdays' && <DPBirthdays />}
          {benefitTab === 'baskets'   && <DPBaskets />}
        </div>
      )}

    </div>
  );
};

export default PersonnelDepartmentPage;