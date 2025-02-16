import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Package, ArrowLeft, Plus } from 'lucide-react';

const SectorRequests = () => {
  const { id } = useParams();
  const [sector, setSector] = React.useState(null);
  const [requests, setRequests] = React.useState([]);
  const [newItem, setNewItem] = React.useState({ name: '', quantity: 1 });
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const fetchRequests = async () => {
    const { data: requestsData } = await supabase
      .from('requisitions')
      .select('*')
      .eq('sector_id', id)
      .eq('status', 'pending')
      .order('updated_at', { ascending: false });
    setRequests(requestsData || []);
  };

  React.useEffect(() => {
    const fetchData = async () => {
      const { data: sectorData } = await supabase
        .from('sectors')
        .select('*')
        .eq('id', id)
        .single();
      setSector(sectorData);

      fetchRequests();
    };
    fetchData();
  }, [id]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      const existingItem = requests.find(r => r.item_name.toLowerCase() === newItem.name.toLowerCase());
      
      if (existingItem) {
        const { data } = await supabase
          .from('requisitions')
          .update({ 
            quantity: existingItem.quantity + newItem.quantity,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingItem.id)
          .select();
        
        setRequests(requests.map(r => 
          r.id === existingItem.id ? data[0] : r
        ));
      } else {
        const { data } = await supabase
          .from('requisitions')
          .insert([{
            sector_id: id,
            item_name: newItem.name,
            quantity: newItem.quantity,
            status: 'pending'
          }])
          .select();
        
        if (data) {
          setRequests([data[0], ...requests]);
        }
      }
      
      setNewItem({ name: '', quantity: 1 });
    } catch (error) {
      console.error('Erro ao adicionar item:', error);
      alert('Erro ao adicionar item. Tente novamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQuantityChange = async (requestId, newQuantity) => {
    if (newQuantity >= 0) {
      const { data } = await supabase
        .from('requisitions')
        .update({ 
          quantity: newQuantity,
          updated_at: new Date().toISOString()
        })
        .eq('id', requestId)
        .eq('status', 'pending')
        .select();
      
      if (data) {
        setRequests(prevRequests => {
          const updatedRequests = prevRequests.map(r => 
            r.id === requestId ? data[0] : r
          );
          return [...updatedRequests].sort((a, b) => 
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
          );
        });
      }
    }
  };

  if (!sector) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-white"></div>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto px-4">
      <div className="flex items-center space-x-4 mb-8">
        <Link
          to="/"
          className="flex items-center text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
        >
          <ArrowLeft className="h-5 w-5 mr-1" />
          Voltar
        </Link>
        <h1 className="text-3xl font-bold text-gray-800 dark:text-white">
          Requisições - {sector.name}
        </h1>
      </div>

      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md mb-8">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-4 flex items-center">
          <Plus className="h-5 w-5 mr-2" />
          Nova Requisição
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Nome do Item
              </label>
              <input
                type="text"
                required
                value={newItem.name}
                onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500"
                placeholder="Ex: Papel Higiênico"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Quantidade
              </label>
              <input
                type="number"
                min="1"
                required
                value={newItem.quantity}
                onChange={(e) => setNewItem({ ...newItem, quantity: parseInt(e.target.value) })}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
          >
            {isSubmitting ? (
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
            ) : (
              <>
                <Plus className="h-5 w-5 mr-2" />
                Adicionar Item
              </>
            )}
          </button>
        </form>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white flex items-center">
            <Package className="h-5 w-5 mr-2" />
            Itens Pendentes
          </h2>
        </div>
        {requests.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            Nenhum item pendente no momento
          </div>
        ) : (
          <table className="min-w-full">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Item
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Quantidade
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Última Atualização
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {requests.map((request) => (
                <tr key={request.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">
                    {request.item_name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">
                    <div className="flex items-center space-x-2">
                      <input
                        type="number"
                        min="0"
                        value={request.quantity}
                        onChange={(e) => handleQuantityChange(request.id, parseInt(e.target.value))}
                        className="w-20 rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                      <span className="text-gray-500 dark:text-gray-400">unidades</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">
                    {new Date(request.updated_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default SectorRequests;