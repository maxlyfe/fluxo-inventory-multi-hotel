/* eslint-disable @typescript-eslint/no-explicit-any */
// Importações de bibliotecas e componentes.
import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { 
  Package, BarChart3, Building2, ShieldCheck, ChevronDown, ChevronUp, 
  Lock, Boxes, Hotel, ChefHat, UtensilsCrossed, ShoppingCart, DollarSign,
  FileText, CreditCard, Wrench, GlassWater,
  UsersRound // --- NOVO: Ícone para o Departamento Pessoal ---
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useHotel } from '../context/HotelContext';

// Componente da página Home.
const Home = () => {
  // Estados para controlar os setores e a visibilidade da lista.
  const [sectors, setSectors] = useState<any[]>([]);
  const [showSectors, setShowSectors] = useState(true);
  // Hooks para obter informações de autenticação e hotel selecionado.
  const { user } = useAuth();
  const { selectedHotel } = useHotel();
  const navigate = useNavigate();

  // Efeito para redirecionar para select-hotel se não houver hotel selecionado.
  useEffect(() => {
    if (!selectedHotel) {
      navigate('/select-hotel', { replace: true });
    }
  }, [selectedHotel, navigate]);

  // Efeito para buscar os setores do hotel selecionado.
  React.useEffect(() => {
    const fetchSectors = async () => {
      if (!selectedHotel?.id) return; 
      const { data } = await supabase
        .from('sectors')
        .select('*')
        .eq('hotel_id', selectedHotel.id); 
      if (data) setSectors(data);
    };
    fetchSectors();
  }, [selectedHotel]);

  // Função para renderizar a seção administrativa.
  const renderAdminSection = () => {
    // Se não houver usuário logado, mostra um card de login.
    if (!user) {
      return (
        <Link
          to="/login"
          className="block bg-gradient-to-br from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 rounded-xl shadow-lg hover:shadow-xl transform hover:-translate-y-1 transition-all duration-200"
        >
          <div className="px-4 sm:px-8 py-6">
            <div className="flex items-center">
              <div className="bg-white/10 p-3 rounded-lg mr-3 sm:mr-5 shrink-0">
                <Lock className="h-6 w-6 sm:h-8 sm:w-8 text-white" />
              </div>
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-white mb-1">Área Administrativa</h2>
                <p className="text-sm sm:text-base text-blue-100">Acesso restrito para funcionários autorizados</p>
              </div>
            </div>
          </div>
          <div className="px-4 sm:px-8 py-3 bg-black/10 rounded-b-xl">
            <p className="text-sm text-blue-100 flex items-center">
              <span>Clique para fazer login</span>
              <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
              </svg>
            </p>
          </div>
        </Link>
      );
    }

    // Se o usuário estiver logado, renderiza os botões de acordo com sua role.
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {(user.role === 'admin' || user.role === 'inventory') && (
          <>
            <Link
              to="/inventory"
              className="bg-gradient-to-br from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 p-4 sm:p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1"
            >
              <div className="flex items-center space-x-3 sm:space-x-4">
                <div className="bg-white/10 p-2 sm:p-3 rounded-lg shrink-0">
                  <Boxes className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
                </div>
                <div>
                  <h2 className="text-lg sm:text-xl font-semibold text-white">Inventário</h2>
                  <p className="text-sm text-purple-100 opacity-90">Gerenciar estoque</p>
                </div>
              </div>
            </Link>

            <Link
              to="/purchases"
              className="bg-gradient-to-br from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 p-4 sm:p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1"
            >
              <div className="flex items-center space-x-3 sm:space-x-4">
                <div className="bg-white/10 p-2 sm:p-3 rounded-lg shrink-0">
                  <ShoppingCart className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
                </div>
                <div>
                  <h2 className="text-lg sm:text-xl font-semibold text-white">Compras</h2>
                  <p className="text-sm text-amber-100 opacity-90">Gerenciar pedidos</p>
                </div>
              </div>
            </Link>
            
            <Link
              to="/reports" 
              className="bg-gradient-to-br from-cyan-500 to-cyan-600 hover:from-cyan-600 hover:to-cyan-700 p-4 sm:p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1"
            >
              <div className="flex items-center space-x-3 sm:space-x-4">
                <div className="bg-white/10 p-2 sm:p-3 rounded-lg shrink-0">
                  <FileText className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
                </div>
                <div>
                  <h2 className="text-lg sm:text-xl font-semibold text-white">Relatórios</h2>
                  <p className="text-sm text-cyan-100 opacity-90">Controle semanal</p>
                </div>
              </div>
            </Link>

            <Link
              to="/authorizations"
              className="bg-gradient-to-br from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 p-4 sm:p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1"
            >
              <div className="flex items-center space-x-3 sm:space-x-4">
                <div className="bg-white/10 p-2 sm:p-3 rounded-lg shrink-0">
                  <CreditCard className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
                </div>
                <div>
                  <h2 className="text-lg sm:text-xl font-semibold text-white">Autorizações</h2>
                  <p className="text-sm text-teal-100 opacity-90">Gerenciar autorizações</p>
                </div>
              </div>
            </Link>
          </>
        )}

        {(user.role === 'admin') && (
          <>
            <Link
              to="/admin"
              className="bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 p-4 sm:p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1"
            >
              <div className="flex items-center space-x-3 sm:space-x-4">
                <div className="bg-white/10 p-2 sm:p-3 rounded-lg shrink-0">
                  <Package className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
                </div>
                <div>
                  <h2 className="text-lg sm:text-xl font-semibold text-white">Requisições</h2>
                  <p className="text-sm text-blue-100 opacity-90">Pedidos dos setores</p>
                </div>
              </div>
            </Link>

            <Link
              to="/finances"
              className="bg-gradient-to-br from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 p-4 sm:p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1"
            >
              <div className="flex items-center space-x-3 sm:space-x-4">
                <div className="bg-white/10 p-2 sm:p-3 rounded-lg shrink-0">
                  <DollarSign className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
                </div>
                <div>
                  <h2 className="text-lg sm:text-xl font-semibold text-white">Financeiro</h2>
                  <p className="text-sm text-emerald-100 opacity-90">Controle financeiro</p>
                </div>
              </div>
            </Link>
          </>
        )}

        {(user.role === 'admin' || user.role === 'management') && (
          <>
            <Link
              to="/management"
              className="bg-gradient-to-br from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 p-4 sm:p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1"
            >
              <div className="flex items-center space-x-3 sm:space-x-4">
                <div className="bg-white/10 p-2 sm:p-3 rounded-lg shrink-0">
                  <BarChart3 className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
                </div>
                <div>
                  <h2 className="text-lg sm:text-xl font-semibold text-white">Gerência</h2>
                  <p className="text-sm text-green-100 opacity-90">Relatórios e análises</p>
                </div>
              </div>
            </Link>
            {/* --- NOVO BOTÃO ADICIONADO AQUI --- */}
            <Link
              to="/personnel-department"
              className="bg-gradient-to-br from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700 p-4 sm:p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1"
            >
              <div className="flex items-center space-x-3 sm:space-x-4">
                <div className="bg-white/10 p-2 sm:p-3 rounded-lg shrink-0">
                  <UsersRound className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
                </div>
                <div>
                  <h2 className="text-lg sm:text-xl font-semibold text-white">Departamento Pessoal</h2>
                  <p className="text-sm text-rose-100 opacity-90">Contratos e colaboradores</p>
                </div>
              </div>
            </Link>
          </>
        )}
      </div>
    );
  };

  // Função para renderizar os estoques setoriais.
  const renderSectorStocks = () => {
    if (!user) return null;

    const stockSectorNames = ['Cozinha', 'Restaurante', 'Governança', 'Bar Piscina', 'Manutenção'];

    const sectorStocksData = sectors
      .filter(sector => stockSectorNames.includes(sector.name))
      .map(sector => {
        let icon = Hotel;
        let color = 'from-gray-500 to-gray-600';
        
        if (sector.name === 'Cozinha') {
          icon = ChefHat;
          color = 'from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700';
        } else if (sector.name === 'Restaurante') {
          icon = UtensilsCrossed;
          color = 'from-red-500 to-red-600 hover:from-red-600 hover:to-red-700';
        } else if (sector.name === 'Governança') {
            icon = ShieldCheck;
            color = 'from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700';
        } else if (sector.name === 'Bar Piscina') {
            icon = GlassWater;
            color = 'from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700';
        } else if (sector.name === 'Manutenção') {
            icon = Wrench;
            color = 'from-sky-500 to-sky-600 hover:from-sky-600 hover:to-sky-700';
        }

        return {
          id: sector.id,
          name: `Estoque ${sector.name}`,
          role: sector.role,
          icon,
          color
        };
      });

    const userHasAccess = (role: string) => {
      if (user.role === 'admin') return true;
      const allowedRolesForNonAdmins: { [key: string]: string } = {
        'sup-governanca': 'governance',
        'kitchen': 'kitchen',
        'restaurant': 'restaurant',
        'bar': 'bar'
      };
      return allowedRolesForNonAdmins[user.role] === role;
    };

    const accessibleStocks = sectorStocksData.filter(stock => userHasAccess(stock.role));

    if (accessibleStocks.length === 0) return null;
    
    return (
      <div className="space-y-6">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-white">Estoques Setoriais</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {accessibleStocks.map((stock) => {
            const Icon = stock.icon;
            return (
              <Link
                key={stock.id}
                to={`/sector-stock/${stock.id}`}
                className={`bg-gradient-to-br ${stock.color} p-4 sm:p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1`}
              >
                <div className="flex items-center space-x-3 sm:space-x-4">
                  <div className="bg-white/10 p-2 sm:p-3 rounded-lg shrink-0">
                    <Icon className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg sm:text-xl font-semibold text-white">{stock.name}</h2>
                    <p className="text-sm text-white/80">Gerenciar estoque</p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    );
  };

  // Se não houver hotel selecionado, não renderiza nada.
  if (!selectedHotel) {
    return null;
  }

  // Renderização principal do componente.
  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {user ? (
        <div className="space-y-8">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-white mb-4">Área Administrativa</h2>
            {renderAdminSection()}
          </div>
          {renderSectorStocks()}
          <div>
            <button
              onClick={() => setShowSectors(!showSectors)}
              className="w-full flex items-center justify-between bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm hover:shadow-md transition-all duration-200"
            >
              <div className="flex items-center space-x-3">
                <Building2 className="h-5 w-5 sm:h-6 sm:w-6 text-blue-600 dark:text-blue-400" />
                <h2 className="text-lg sm:text-xl font-semibold text-gray-800 dark:text-white">Setores</h2>
              </div>
              {showSectors ? (
                <ChevronUp className="h-5 w-5 text-gray-500 dark:text-gray-400" />
              ) : (
                <ChevronDown className="h-5 w-5 text-gray-500 dark:text-gray-400" />
              )}
            </button>

            {showSectors && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {sectors.map((sector: any) => (
                  <Link
                    key={sector.id}
                    to={`/sector/${sector.id}`}
                    className="bg-white dark:bg-gray-800 p-4 sm:p-6 rounded-xl shadow-md hover:shadow-lg transition-all duration-200 group"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="bg-blue-100 dark:bg-blue-900 p-2 rounded-lg group-hover:bg-blue-200 dark:group-hover:bg-blue-800 transition-colors shrink-0">
                        <Building2 className="h-5 w-5 sm:h-6 sm:w-6 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div>
                        <h3 className="text-base sm:text-lg font-semibold text-gray-800 dark:text-white">{sector.name}</h3>
                        <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">Ver requisições</p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-6 sm:space-y-8">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-white mb-4">Setores</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {sectors.map((sector: any) => (
                <Link
                  key={sector.id}
                  to={`/sector/${sector.id}`}
                  className="bg-white dark:bg-gray-800 p-4 sm:p-6 rounded-xl shadow-md hover:shadow-lg transition-all duration-200 group"
                >
                  <div className="flex items-center space-x-3">
                    <div className="bg-blue-100 dark:bg-blue-900 p-2 rounded-lg group-hover:bg-blue-200 dark:group-hover:bg-blue-800 transition-colors shrink-0">
                      <Building2 className="h-5 w-5 sm:h-6 sm:w-6 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <h3 className="text-base sm:text-lg font-semibold text-gray-800 dark:text-white">{sector.name}</h3>
                      <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">Ver requisições</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-white mb-4">Área Administrativa</h2>
            {renderAdminSection()}
          </div>
        </div>
      )}
    </div>
  );
};

export default Home;
