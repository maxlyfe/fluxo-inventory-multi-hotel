import React from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Apple, Shirt, Sandwich, Info } from 'lucide-react';

type CategoryKey = 'HORTIFRUTI' | 'LAVANDERIA' | 'PADARIA';

const CATEGORY_DETAILS: { [key in CategoryKey]: { name: string, colorHex: string, icon: React.ElementType } } = {
  HORTIFRUTI: { name: "Hortifruti", colorHex: "#22c55e", icon: Apple },
  LAVANDERIA: { name: "Lavanderia", colorHex: "#3b82f6", icon: Shirt },
  PADARIA: { name: "Padaria", colorHex: "#eab308", icon: Sandwich },
};

interface ChartData {
    month: Date;
    results: { [key in CategoryKey]: number };
}

interface ExpensesChartProps {
    chartData: ChartData[];
    maxExpensePerGuest: number;
}

const CHART_HEIGHT = 180;
const CHART_PADDING_Y = 20; // Espaçamento vertical
const CHART_PADDING_X = 56; // Espaçamento nas laterais para centralizar os pontos

const ExpensesChart: React.FC<ExpensesChartProps> = ({ chartData, maxExpensePerGuest }) => {
    
    // Calcula a largura total baseada no número de meses para preencher o espaço
    const getCoordsAndPaths = () => {
        const categories: CategoryKey[] = ['HORTIFRUTI', 'LAVANDERIA', 'PADARIA'];
        const output: { [key: string]: { pathD: string; points: any[] } } = {};

        categories.forEach(catKey => {
            let pathD = '';
            let points = [];
            let segmentStarted = false;

            chartData.forEach((data, index) => {
                const value = data.results[catKey] || 0;
                
                // Calcula a posição X de cada mês
                const x = (index / (chartData.length - 1)) * (112 * (chartData.length - 1)) + CHART_PADDING_X;
                
                if (value > 0) {
                    const y = CHART_HEIGHT - CHART_PADDING_Y - Math.max((value / maxExpensePerGuest) * (CHART_HEIGHT - CHART_PADDING_Y * 2), 0);
                    
                    // Se a linha não começou, usa 'M' (Move To), senão usa 'L' (Line To)
                    pathD += `${segmentStarted ? 'L' : 'M'} ${x} ${y} `;
                    segmentStarted = true;
                    points.push({ x, y, value });
                } else {
                    // Interrompe a linha se o valor for zero
                    segmentStarted = false;
                }
            });
            output[catKey] = { pathD, points };
        });

        return output;
    };

    const lines = getCoordsAndPaths();

    return (
        <div>
            <div className="overflow-x-auto pb-4">
                <svg width={`${chartData.length * 112}px`} height={CHART_HEIGHT}>
                    {/* Linhas de Guia Horizontais */}
                    {[0, 0.25, 0.5, 0.75, 1].map(f => (
                        <g key={f} className="text-gray-300 dark:text-gray-600">
                           <line x1="0" x2="100%" y1={CHART_HEIGHT - CHART_PADDING_Y - (f * (CHART_HEIGHT - CHART_PADDING_Y * 2))} y2={CHART_HEIGHT - CHART_PADDING_Y - (f * (CHART_HEIGHT - CHART_PADDING_Y * 2))} stroke="currentColor" strokeWidth="1" strokeDasharray="3,3" />
                           <text x="5" y={CHART_HEIGHT - CHART_PADDING_Y - (f * (CHART_HEIGHT - CHART_PADDING_Y * 2)) - 5} className="text-xs fill-current text-gray-500 dark:text-gray-400">
                               {(maxExpensePerGuest * f).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}
                           </text>
                        </g>
                    ))}

                    {/* Desenha as linhas e os pontos para cada categoria */}
                    {(Object.keys(CATEGORY_DETAILS) as CategoryKey[]).map(catKey => {
                        const { pathD, points } = lines[catKey];
                        const details = CATEGORY_DETAILS[catKey];
                        return (
                            <g key={catKey}>
                                <path d={pathD} stroke={details.colorHex} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                                {points.map((p, i) => (
                                    <g key={i} className="group">
                                        <circle cx={p.x} cy={p.y} r="8" fill={details.colorHex} className="opacity-0 group-hover:opacity-30 transition-opacity" />
                                        <circle cx={p.x} cy={p.y} r="4" fill={details.colorHex} stroke="white" strokeWidth="2" />
                                        <text x={p.x} y={p.y - 15} textAnchor="middle" className="text-xs font-bold fill-current text-gray-900 dark:text-white opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                            {p.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                        </text>
                                    </g>
                                ))}
                            </g>
                        );
                    })}
                </svg>

                {/* Eixo X com os meses */}
                <div className="flex" style={{width: `${chartData.length * 112}px`}}>
                    {chartData.map(data => (
                        <div key={data.month.toISOString()} className="w-28 text-center mt-1 text-sm font-medium text-gray-600 dark:text-gray-400">
                             {format(data.month, 'MMM/yy', { locale: ptBR })}
                        </div>
                    ))}
                </div>
            </div>
            
            <div className="mt-4 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm">
                {Object.values(CATEGORY_DETAILS).map(details => {
                    const Icon = details.icon;
                    return (
                        <div key={details.name} className="flex items-center gap-2 font-medium" style={{color: details.colorHex}}>
                            <div className="w-3 h-3 rounded-full" style={{backgroundColor: details.colorHex}}></div>
                            {details.name}
                        </div>
                    )
                })}
            </div>
        </div>
    );
};

export default ExpensesChart;