import React from 'react';
import { supabase } from '../lib/supabase';
import { Package, Check, X, Search, ChevronDown, ChevronUp } from 'lucide-react';

const AdminPanel = () => {
  const [requests, setRequests] = React.useState([]);
  const [expandedItems, setExpandedItems] = React.useState({});
  const [searchTerm, setSearchTerm] = React.useState('');
  const [deliveredItems, setDeliveredItems] = React.useState([]);
  const [expandedWeeks, setExpandedWeeks] = React.useState({});

  React.useEffect(() => {
    const fetchRequests = async () => {
      const { data: pendingData } = await supabase
        .from('requisitions')
        .select(`
          *,
          sectors (name)
        `)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      setRequests(pendingData || []);

      // Buscar itens entregues dos últimos 3 meses
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      
      const { data: deliveredData } = await supabase
        .from('requisitions')
        .select(`
          *,
          sectors (name)
        `)
        .eq('status', 'delivered')
        .gte('updated_at', threeMonthsAgo.toISOString())
        .order('updated_at', { ascending: false });
      setDeliveredItems(deliveredData || []);
    };

    fetchRequests();

    // Subscribe to changes
    const channel = supabase
      .channel('custom-all-channel')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'requisitions' },
        () => {
          fetchRequests();
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, []);

  const toggleExpand = (id) => {
    setExpandedItems(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const toggleWeek = (weekId) => {
    setExpandedWeeks(prev => ({
      ...prev,
      [weekId]: !prev[weekId]
    }));
  };

  const handleDelivery = async (request, deliveredQuantity) => {
    const { error } = await supabase
      .from('requisitions')
      .update({
        status: 'delivered',
        delivered_quantity: deliveredQuantity,
        updated_at: new Date().toISOString()
      })
      .eq('id', request.id);

    if (error) {
      console.error('Error updating request:', error);
      alert('Erro ao atualizar requisição');
    }
  };

  const handleReject = async (request, reason) => {
    const { error } = await supabase
      .from('requisitions')
      .update({
        status: 'rejected',
        rejection_reason: reason,
        updated_at: new Date().toISOString()
      })
      .eq('id', request.id);

    if (error) {
      console.error('Error rejecting request:', error);
      alert('Erro ao rejeitar requisição');
    }
  };

  // Agrupar requisições pendentes por setor
  const filteredRequests = requests.filter(request =>
    request.item_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const groupedRequests = filteredRequests.reduce((acc, request) => {
    const sectorName = request.sectors.name;
    if (!acc[sectorName]) {
      acc[sectorName] = [];
    }
    acc[sectorName].push(request);
    return acc;
  }, {});

  // Agrupar itens entregues por semana
  const groupedByWeek = deliveredItems.reduce((acc, item) => {
    const date = new Date(item.updated_at);
    // Encontrar a segunda-feira da semana
    const monday = new Date(date);
    monday.setDate(date.getDate() - date.getDay() + 1);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    
    const weekId = monday.toISOString().split('T')[0];
    const weekLabel = `${monday.toLocaleDateString()} - ${sunday.toLocaleDateString()}`;
    
    if (!acc[weekId]) {
      acc[weekId] = {
        label: weekLabel,
        items: []
      };
    }
    acc[weekId].items.push(item);
    return acc;
  }, {});

  return (
    <div className="max-w-6xl mx-auto px-4">
      <h1 className="text-3xl font-bold text-gray-800 dark:text-white mb-8">
        Painel Administrativo
      </h1>

      {/* Barra de busca */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar item..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Requisições Pendentes */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-4">
          Requisições Pendentes
        </h2>
        {Object.entries(groupedRequests).map(([sectorName, sectorRequests]) => (
          <div key={sectorName} className="mb-4">
            <div
              className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 cursor-pointer"
              onClick={() => toggleExpand(sectorName)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Package className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  <h3 className="text-lg font-semibold text-gray-800 dark:text-white">
                    {sectorName}
                  </h3>
                  <span className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 text-sm px-2 py-1 rounded-full">
                    {sectorRequests.length} itens
                  </span>
                </div>
                <span className="text-gray-500 dark:text-gray-400">
                  {expandedItems[sectorName] ? <ChevronUp /> : <ChevronDown />}
                </span>
              </div>
            </div>

            {expandedItems[sectorName] && (
              <div className="mt-2 bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                        Item
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                        Quantidade Solicitada
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                        Quantidade a Entregar
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                        Ações
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {sectorRequests.map((request) => (
                      <tr key={request.id}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">
                          {request.item_name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">
                          {request.quantity}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <input
                            type="number"
                            defaultValue={request.quantity}
                            min="0"
                            max={request.quantity}
                            className="w-24 rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500"
                            onChange={(e) => {
                              request.delivered_quantity = parseInt(e.target.value);
                            }}
                          />
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <div className="flex space-x-2">
                            <button
                              onClick={() => handleDelivery(request, request.delivered_quantity || request.quantity)}
                              className="flex items-center px-3 py-1 bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 rounded-md hover:bg-green-200 dark:hover:bg-green-800 transition-colors"
                            >
                              <Check className="h-4 w-4 mr-1" />
                              Entregar
                            </button>
                            <button
                              onClick={() => {
                                const reason = prompt('Motivo da rejeição:');
                                if (reason) {
                                  handleReject(request, reason);
                                }
                              }}
                              className="flex items-center px-3 py-1 bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 rounded-md hover:bg-red-200 dark:hover:bg-red-800 transition-colors"
                            >
                              <X className="h-4 w-4 mr-1" />
                              Rejeitar
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Itens Entregues por Semana */}
      <div>
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-4">
          Histórico de Entregas
        </h2>
        {Object.entries(groupedByWeek).map(([weekId, { label, items }]) => (
          <div key={weekId} className="mb-4">
            <div
              className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 cursor-pointer"
              onClick={() => toggleWeek(weekId)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Package className="h-5 w-5 text-green-600 dark:text-green-400" />
                  <h3 className="text-lg font-semibold text-gray-800 dark:text-white">
                    Semana: {label}
                  </h3>
                  <span className="bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 text-sm px-2 py-1 rounded-full">
                    {items.length} itens
                  </span>
                </div>
                <span className="text-gray-500 dark:text-gray-400">
                  {expandedWeeks[weekId] ? <ChevronUp /> : <ChevronDown />}
                </span>
              </div>
            </div>

            {expandedWeeks[weekId] && (
              <div className="mt-2 bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                        Data/Hora
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                        Setor
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                        Item
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                        Quantidade
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {items.map((item) => (
                      <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">
                          {new Date(item.updated_at).toLocaleString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">
                          {item.sectors.name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">
                          {item.item_name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">
                          {item.delivered_quantity || item.quantity}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default AdminPanel;