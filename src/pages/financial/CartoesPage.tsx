import React from 'react';
import { CreditCard } from 'lucide-react';
import { useHotel } from '../../context/HotelContext';
import CreditCardManager from '../../components/financial/CreditCardManager';

export default function CartoesPage() {
  const { selectedHotel } = useHotel();

  if (!selectedHotel?.id) {
    return <div className="max-w-7xl mx-auto px-4 py-20 text-center text-gray-500">Selecione um hotel.</div>;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-6">
        <CreditCard className="h-8 w-8 text-blue-500" />
        <h1 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white">Cartões de Crédito</h1>
      </div>
      <CreditCardManager hotelId={selectedHotel.id} />
    </div>
  );
}
