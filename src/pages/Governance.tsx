import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import {
  Box,
  Users,
  PackageOpen,
  AlertTriangle,
  FileText,
  Plus,
  Search,
  Download,
  Edit2,
  Trash2,
  CheckCircle,
  XCircle,
  ArrowUpRight,
  ArrowDownLeft,
  Scale
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { startOfWeek, endOfWeek, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAuth } from '../context/AuthContext'; // Ajuste o caminho se necessário
import { useNavigate } from 'react-router-dom';


interface Product {
  id: string;
  name: string;
  quantity: number;
  min_quantity: number;
  max_quantity: number;
}

interface Housekeeper {
  id: string;
  name: string;
  active: boolean;
}

interface StockMovement {
  id: string;
  housekeeper_id: string;
  product_id: string;
  quantity_sent: number;
  quantity_returned?: number;
  status: 'sent' | 'returned' | 'completed';
  created_at: string;
  products: {
    name: string;
  };
  housekeepers: {
    name: string;
  };
}

interface Loss {
  id: string;
  product_id: string;
  quantity: number;
  loss_type: 'employee' | 'guest';
  employee_name?: string;
  reason: string;
  created_at: string;
  products: {
    name: string;
  };
}

const Governance = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('stock');
  const [products, setProducts] = useState<Product[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [housekeepers, setHousekeepers] = useState<Housekeeper[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [losses, setLosses] = useState<Loss[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [showLossForm, setShowLossForm] = useState(false);
  const [showMovementForm, setShowMovementForm] = useState(false);
  const [showInitialBalanceForm, setShowInitialBalanceForm] = useState(false);

  // Form states
  const [newProduct, setNewProduct] = useState({
    product_id: '',
    quantity: 0,
    min_quantity: 0,
    max_quantity: 100
  });

  const [initialBalance, setInitialBalance] = useState({
    product_id: '',
    quantity: 0
  });

  const [newHousekeeper, setNewHousekeeper] = useState({
    name: ''
  });

  const [newMovement, setNewMovement] = useState({
    housekeeper_id: '',
    product_id: '',
    quantity_sent: 0
  });

  const [newLoss, setNewLoss] = useState({
    product_id: '',
    quantity: 0,
    loss_type: 'employee',
    employee_name: '',
    reason: ''
  });

  useEffect(() => {
    if (!user || (user.role !== 'sup-governanca' && user.role !== 'admin')) {
      navigate('/');
      return;
    }

    fetchData();
  }, [user, navigate]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');

      // Fetch all available products
      const { data: productsData } = await supabase
        .from('products')
        .select('*')
        .order('name');
      setAllProducts(productsData || []);

      // Fetch governance stock
      const { data: stockData } = await supabase
        .from('governance_stock')
        .select(`
          *,
          products (
            id,
            name
          )
        `);
      setProducts(stockData || []);

      // Fetch housekeepers
      const { data: housekeepersData } = await supabase
        .from('housekeepers')
        .select('*')
        .order('name');
      setHousekeepers(housekeepersData || []);

      // Fetch recent movements
      const { data: movementsData } = await supabase
        .from('housekeeper_stock_movements')
        .select(`
          *,
          products (name),
          housekeepers (name)
        `)
        .order('created_at', { ascending: false })
        .limit(50);
      setMovements(movementsData || []);

      // Fetch recent losses
      const { data: lossesData } = await supabase
        .from('governance_losses')
        .select(`
          *,
          products (name)
        `)
        .order('created_at', { ascending: false })
        .limit(50);
      setLosses(lossesData || []);

    } catch (err) {
      console.error('Error fetching data:', err);
      setError('Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { error } = await supabase
        .from('governance_stock')
        .insert([newProduct]);

      if (error) throw error;

      setShowAddForm(false);
      setNewProduct({
        product_id: '',
        quantity: 0,
        min_quantity: 0,
        max_quantity: 100
      });
      fetchData();
    } catch (err) {
      console.error('Error adding product:', err);
      setError('Erro ao adicionar produto');
    }
  };

  const handleInitialBalance = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { error } = await supabase
        .rpc('set_governance_initial_balance', {
          p_product_id: initialBalance.product_id,
          p_quantity: initialBalance.quantity
        });

      if (error) throw error;

      setShowInitialBalanceForm(false);
      setInitialBalance({
        product_id: '',
        quantity: 0
      });
      fetchData();
    } catch (err) {
      console.error('Error setting initial balance:', err);
      setError('Erro ao definir balanço inicial');
    }
  };

  const handleAddHousekeeper = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { error } = await supabase
        .from('housekeepers')
        .insert([newHousekeeper]);

      if (error) throw error;

      setNewHousekeeper({ name: '' });
      fetchData();
    } catch (err) {
      console.error('Error adding housekeeper:', err);
      setError('Erro ao adicionar camareira');
    }
  };

  const handleAddMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { error } = await supabase
        .from('housekeeper_stock_movements')
        .insert([{
          ...newMovement,
          status: 'sent'
        }]);

      if (error) throw error;

      setShowMovementForm(false);
      setNewMovement({
        housekeeper_id: '',
        product_id: '',
        quantity_sent: 0
      });
      fetchData();
    } catch (err) {
      console.error('Error adding movement:', err);
      setError('Erro ao registrar movimentação');
    }
  };

  const handleAddLoss = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { error } = await supabase
        .from('governance_losses')
        .insert([newLoss]);

      if (error) throw error;

      setShowLossForm(false);
      setNewLoss({
        product_id: '',
        quantity: 0,
        loss_type: 'employee',
        employee_name: '',
        reason: ''
      });
      fetchData();
    } catch (err) {
      console.error('Error adding loss:', err);
      setError('Erro ao registrar perda');
    }
  };

  const handleReturnItems = async (movement: StockMovement, returnedQuantity: number) => {
    try {
      if (returnedQuantity > movement.quantity_sent) {
        throw new Error('Quantidade devolvida não pode ser maior que a quantidade enviada');
      }

      const { error } = await supabase
        .from('housekeeper_stock_movements')
        .update({
          quantity_returned: returnedQuantity,
          status: 'completed'
        })
        .eq('id', movement.id);

      if (error) throw error;

      fetchData();
    } catch (err) {
      console.error('Error returning items:', err);
      setError('Erro ao registrar devolução');
    }
  };

  const exportLossReport = () => {
    const startDate = startOfWeek(new Date(), { weekStartsOn: 1 });
    const endDate = endOfWeek(new Date(), { weekStartsOn: 1 });

    const weeklyLosses = losses.filter(loss => {
      const lossDate = new Date(loss.created_at);
      return lossDate >= startDate && lossDate <= endDate;
    });

    const reportData = weeklyLosses.map(loss => ({
      'Data': format(new Date(loss.created_at), 'dd/MM/yyyy HH:mm'),
      'Item': loss.products.name,
      'Quantidade': loss.quantity,
      'Tipo': loss.loss_type === 'employee' ? 'Funcionário' : 'Hotel',
      'Responsável': loss.employee_name || '-',
      'Motivo': loss.reason
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(reportData);

    // Set column widths
    const colWidths = [
      { wch: 20 }, // Data
      { wch: 30 }, // Item
      { wch: 15 }, // Quantidade
      { wch: 15 }, // Tipo
      { wch: 20 }, // Responsável
      { wch: 40 }  // Motivo
    ];
    ws['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, 'Relatório de Perdas');
    XLSX.writeFile(wb, `relatorio-perdas-${format(startDate, 'dd-MM-yyyy')}.xlsx`);
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8 space-y-4 md:space-y-0">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white flex items-center">
          <Box className="h-8 w-8 text-blue-600 dark:text-blue-400 mr-3" />
          Governança
        </h1>
        <div className="flex items-center space-x-4">
          <button
            onClick={() => setActiveTab('stock')}
            className={`flex items-center px-4 py-2 rounded-lg transition-colors ${
              activeTab === 'stock'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
            }`}
          >
            <PackageOpen className="h-5 w-5 mr-2" />
            Estoque
          </button>
          <button
            onClick={() => setActiveTab('housekeepers')}
            className={`flex items-center px-4 py-2 rounded-lg transition-colors ${
              activeTab === 'housekeepers'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
            }`}
          >
            <Users className="h-5 w-5 mr-2" />
            Camareiras
          </button>
          <button
            onClick={() => setActiveTab('losses')}
            className={`flex items-center px-4 py-2 rounded-lg transition-colors ${
              activeTab === 'losses'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
            }`}
          >
            <AlertTriangle className="h-5 w-5 mr-2" />
            Perdas
          </button>
          <button
            onClick={exportLossReport}
            className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            <FileText className="h-5 w-5 mr-2" />
            Relatório
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg flex items-center">
          <AlertTriangle className="h-5 w-5 mr-2" />
          {error}
        </div>
      )}

      {/* Stock Management */}
      {activeTab === 'stock' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <div className="relative">
              <input
                type="text"
                placeholder="Buscar item..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              />
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
            </div>
            <div className="flex space-x-2">
              <button
                onClick={() => setShowInitialBalanceForm(true)}
                className="flex items-center px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              >
                <Scale className="h-5 w-5 mr-2" />
                Balanço Inicial
              </button>
              <button
                onClick={() => setShowAddForm(true)}
                className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus className="h-5 w-5 mr-2" />
                Adicionar Item
              </button>
            </div>
          </div>


          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Item
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Quantidade
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Mínimo
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Máximo
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {products.map((product) => (
                  <tr key={product.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-200">
                      {product.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">
                      {product.quantity}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">
                      {product.min_quantity}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">
                      {product.max_quantity}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right space-x-2">
                      <button
                        onClick={() => {/* Handle edit */}}
                        className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                        title="Editar"
                      >
                        <Edit2 className="h-5 w-5 inline" />
                      </button>
                      <button
                        onClick={() => {/* Handle delete */}}
                        className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
                        title="Excluir"
                      >
                        <Trash2 className="h-5 w-5 inline" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Housekeepers Management */}
      {activeTab === 'housekeepers' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Housekeepers List */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
              <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-4">
                Camareiras
              </h2>
              <form onSubmit={handleAddHousekeeper} className="mb-4">
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={newHousekeeper.name}
                    onChange={(e) => setNewHousekeeper({ name: e.target.value })}
                    placeholder="Nome da camareira"
                    className="flex-1 rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                    required
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                </div>
              </form>
              <div className="space-y-2">
                {housekeepers.map((housekeeper) => (
                  <div
                    key={housekeeper.id}
                    className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg"
                  >
                    <span className="text-gray-900 dark:text-gray-200">{housekeeper.name}</span>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => {/* Handle edit */}}
                        className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                      >
                        <Edit2 className="h-5 w-5" />
                      </button>
                      <button
                        onClick={() => {/* Handle delete */}}
                        className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
                      >
                        <Trash2 className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Stock Movements */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
              <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-4">
                Movimentações
              </h2>
              <button
                onClick={() => setShowMovementForm(true)}
                className="w-full mb-4 flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                <Plus className="h-5 w-5 mr-2" />
                Nova Movimentação
              </button>
              <div className="space-y-4">
                {movements.map((movement) => (
                  <div
                    key={movement.id}
                    className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <h3 className="font-medium text-gray-900 dark:text-gray-200">
                          {movement.housekeepers.name}
                        </h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {movement.products.name}
                        </p>
                      </div>
                      <span className={`px-2 py-1 text-xs rounded-full ${
                        movement.status === 'completed'
                          ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                          : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                      }`}>
                        {movement.status === 'completed' ? 'Concluído' : 'Em andamento'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <div className="space-y-1">
                        <p className="text-gray-600 dark:text-gray-400">
                          Enviado: {movement.quantity_sent} unidades
                        </p>
                        {movement.quantity_returned !== null && (
                          <p className="text-gray-600 dark:text-gray-400">
                            Devolvido: {movement.quantity_returned} unidades
                          </p>
                        )}
                      </div>
                      {movement.status === 'sent' && (
                        <button
                          onClick={() => {
                            const returnedQuantity = prompt('Quantidade devolvida:');
                            if (returnedQuantity) {
                              handleReturnItems(movement, parseInt(returnedQuantity));
                            }
                          }}
                          className="flex items-center px-3 py-1 bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 rounded-md hover:bg-blue-200 dark:hover:bg-blue-800"
                        >
                          <ArrowDownLeft className="h-4 w-4 mr-1" />
                          Devolver
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Losses Management */}
      {activeTab === 'losses' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold text-gray-800 dark:text-white">
              Registro de Perdas
            </h2>
            <button
              onClick={() => setShowLossForm(true)}
              className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="h-5 w-5 mr-2" />
              Registrar Perda
            </button>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Data
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Item
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Quantidade
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Tipo
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Responsável
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Motivo
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {losses.map((loss) => (
                  <tr key={loss.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">
                      {format(new Date(loss.created_at), 'dd/MM/yyyy HH:mm')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">
                      {loss.products.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">
                      {loss.quantity}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        loss.loss_type === 'employee'
                          ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                          : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                      }`}>
                        {loss.loss_type === 'employee' ? 'Funcionário' : 'Hotel'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">
                      {loss.employee_name || '-'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-200">
                      {loss.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Forms */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Adicionar Item ao Estoque
             </h3>
            <form onSubmit={handleAddProduct} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Item
                </label>
                <select
                  value={newProduct.product_id}
                  onChange={(e) => setNewProduct({ ...newProduct, product_id: e.target.value })}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  required
                >
                  <option value="">Selecione um item</option>
                  {allProducts.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Quantidade
                </label>
                 <input
                  type="number"
                  value={newProduct.quantity}
                  onChange={(e) => setNewProduct({ ...newProduct, quantity: parseInt(e.target.value) })}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  required
                  min="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Quantidade Mínima
                </label>
                <input
                  type="number"
                  value={newProduct.min_quantity}
                  onChange={(e) => setNewProduct({ ...newProduct, min_quantity: parseInt(e.target.value) })}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  required
                  min="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Quantidade Máxima
                </label>
                <input
                  type="number"
                  value={newProduct.max_quantity}
                  onChange={(e) => setNewProduct({ ...newProduct, max_quantity: parseInt(e.target.value) })}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  required
                  min="1"
                />
              </div>
              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Adicionar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Initial Balance Modal */}
      {showInitialBalanceForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Balanço Inicial de Estoque
            </h3>
            <form onSubmit={handleInitialBalance} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Item
                </label>
                <select
                  value={initialBalance.product_id}
                  onChange={(e) => setInitialBalance({ ...initialBalance, product_id: e.target.value })}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  required
                >
                  <option value="">Selecione um item</option>
                  {allProducts.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Quantidade Atual
                </label>
                <input
                  type="number"
                  value={initialBalance.quantity}
                  onChange={(e) => setInitialBalance({ ...initialBalance, quantity: parseInt(e.target.value) })}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  required
                  min="0"
                />
              </div>
              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowInitialBalanceForm(false)}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showMovementForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Nova Movimentação
            </h3>
            <form onSubmit={handleAddMovement} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Camareira
                </label>
                <select
                  value={newMovement.housekeeper_id}
                  onChange={(e) => setNewMovement({ ...newMovement, housekeeper_id: e.target.value })}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  required
                >
                  <option value="">Selecione uma camareira</option>
                  {housekeepers.map((housekeeper) => (
                    <option key={housekeeper.id} value={housekeeper.id}>
                      {housekeeper.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Item
                </label>
                <select
                  value={newMovement.product_id}
                  onChange={(e) => setNewMovement({ ...newMovement, product_id: e.target.value })}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  required
                >
                  <option value="">Selecione um item</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Quantidade
                </label>
                <input
                  type="number"
                  value={newMovement.quantity_sent}
                  onChange={(e) => setNewMovement({ ...newMovement, quantity_sent: parseInt(e.target.value) })}
                  
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  required
                  min="1"
                />
              </div>
              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowMovementForm(false)}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Enviar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showLossForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Registrar Perda
            </h3>
            <form onSubmit={handleAddLoss} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Item
                </label>
                <select
                  value={newLoss.product_id}
                  onChange={(e) => setNewLoss({ ...newLoss, product_id: e.target.value })}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  required
                >
                  <option value="">Selecione um item</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Quantidade
                </label>
                <input
                  type="number"
                  value={newLoss.quantity}
                  onChange={(e) => setNewLoss({ ...newLoss, quantity: parseInt(e.target.value) })}
        
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  required
                  min="1"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Tipo de Perda
                </label>
                <select
                  value={newLoss.loss_type}
                  onChange={(e) => setNewLoss({ ...newLoss, loss_type: e.target.value as 'employee' | 'guest' })}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  required
                >
                  <option value="employee">Funcionário</option>
                  <option value="guest">Hotel</option>
                </select>
              </div>
              {newLoss.loss_type === 'employee' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Nome do Funcionário
                  </label>
                  <input
                    type="text"
                    value={newLoss.employee_name}
                    onChange={(e) => setNewLoss({ ...newLoss, employee_name: e.target.value })}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                    required
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Motivo
                </label>
                <textarea
                  value={newLoss.reason}
                  onChange={(e) => setNewLoss({ ...newLoss, reason: e.target.value })}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  required
                  rows={3}
                />
              </div>
              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowLossForm(false)}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Registrar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Governance;