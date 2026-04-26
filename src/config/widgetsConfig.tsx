import React from 'react';
import { 
  Sun, ShoppingCart, TrendingUp, Hotel, 
  Boxes, Wrench, Link as LinkIcon, Package
} from 'lucide-react';

export type WidgetSize = 'small' | 'medium' | 'large' | 'full';

export interface WidgetDefinition {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<any>;
  module?: string; 
  type: 'standard' | 'action-link';
  defaultSize: WidgetSize;
  component: React.LazyExoticComponent<any> | React.ComponentType<any>;
}

export const WIDGET_SIZE_MAP: Record<WidgetSize, string> = {
  small:  'col-span-12 sm:col-span-6 lg:col-span-3',
  medium: 'col-span-12 sm:col-span-6 lg:col-span-4',
  large:  'col-span-12 lg:col-span-6',
  full:   'col-span-12',
};

export const AVAILABLE_WIDGETS: WidgetDefinition[] = [
  {
    id: 'greeting',
    label: 'Saudação & Clima',
    description: 'Boas-vindas e previsão do tempo.',
    icon: Sun,
    type: 'standard',
    defaultSize: 'full',
    component: React.lazy(() => import('../components/widgets/GreetingWidget')),
  },
  {
    id: 'action-link',
    label: 'Botão de Atalho',
    description: 'Um botão direto para uma página ou setor específico.',
    icon: LinkIcon,
    type: 'action-link',
    defaultSize: 'small',
    component: React.lazy(() => import('../components/widgets/ActionLinkWidget')),
  },
  {
    id: 'pickup-mini',
    label: 'Performance Hoje',
    description: 'UHs e Receita Erbon.',
    icon: TrendingUp,
    module: 'diretoria',
    type: 'standard',
    defaultSize: 'medium',
    component: React.lazy(() => import('../components/widgets/PickupMiniWidget')),
  },
  {
    id: 'occupancy-today',
    label: 'Ocupação Hoje',
    description: 'Resumo de ocupação e fluxo.',
    icon: Hotel,
    module: 'reception',
    type: 'standard',
    defaultSize: 'small',
    component: React.lazy(() => import('../components/widgets/OccupancyTodayWidget')),
  },
  {
    id: 'maintenance-summary',
    label: 'Manutenção',
    description: 'Tickets abertos e urgências.',
    icon: Wrench,
    module: 'maintenance',
    type: 'standard',
    defaultSize: 'small',
    component: React.lazy(() => import('../components/widgets/MaintenanceSummaryWidget')),
  },
  {
    id: 'stock-alerts',
    label: 'Alertas de Estoque',
    description: 'Itens abaixo do mínimo.',
    icon: Boxes,
    module: 'stock',
    type: 'standard',
    defaultSize: 'medium',
    component: React.lazy(() => import('../components/widgets/StockAlertsWidget')),
  }
];
