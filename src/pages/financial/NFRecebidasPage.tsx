import React from 'react';
import { FileSearch } from 'lucide-react';
import { useHotel } from '../../context/HotelContext';
import NFRecebidasTab from '../../components/nf/NFRecebidasTab';

export default function NFRecebidasPage() {
  const { selectedHotel } = useHotel();

  if (!selectedHotel?.id) {
    return <div className="max-w-7xl mx-auto px-4 py-20 text-center text-gray-500">Selecione um hotel.</div>;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-6">
        <FileSearch className="h-8 w-8 text-blue-500" />
        <h1 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white">NF Recebidas</h1>
      </div>
      <NFRecebidasTab hotelId={selectedHotel.id} />
    </div>
  );
}
