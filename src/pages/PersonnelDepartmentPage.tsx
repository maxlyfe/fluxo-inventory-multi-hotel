// src/pages/PersonnelDepartmentPage.tsx
// Container principal do Departamento Pessoal com navegação por abas

import React, { useState } from 'react';
import { UsersRound, Users, CalendarDays, Cake } from 'lucide-react';
import DPEmployees from './dp/DPEmployees';
import DPSchedule from './dp/DPSchedule';
import DPBirthdays from './dp/DPBirthdays';

// ---------------------------------------------------------------------------
// Tabs config
// ---------------------------------------------------------------------------
const TABS = [
  { id: 'employees',  label: 'Colaboradores', icon: Users,        component: 'employees'  },
  { id: 'schedule',   label: 'Escala',        icon: CalendarDays, component: 'schedule'   },
  { id: 'birthdays',  label: 'Aniversários',  icon: Cake,         component: 'birthdays'  },
] as const;

type TabId = typeof TABS[number]['id'];

// ---------------------------------------------------------------------------
const PersonnelDepartmentPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('employees');

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

      {/* Tab navigation */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-2xl mb-6 overflow-x-auto">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
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

      {/* Tab content */}
      <div>
        {activeTab === 'employees' && <DPEmployees />}
        {activeTab === 'schedule'  && <DPSchedule />}
        {activeTab === 'birthdays' && <DPBirthdays />}
      </div>
    </div>
  );
};

export default PersonnelDepartmentPage;