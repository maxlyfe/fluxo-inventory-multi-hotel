import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, MapPin, ArrowRight } from 'lucide-react';
import { hotelGroup } from '../data/hotels';
import { useHotel } from '../context/HotelContext';

const HotelSelection = () => {
  const navigate = useNavigate();
  const { setSelectedHotel } = useHotel();

  const handleSelectHotel = (hotel) => {
    setSelectedHotel(hotel);
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-8 sm:mb-12">
          <Building2 className="mx-auto h-12 w-12 text-blue-600 dark:text-blue-400" />
          <h1 className="mt-4 text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white">
            {hotelGroup.name}
          </h1>
          <p className="mt-2 text-lg text-gray-600 dark:text-gray-400">
            Selecione a unidade para continuar
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {hotelGroup.hotels.map((hotel) => (
            <div
              key={hotel.id}
              className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 flex flex-col h-full"
            >
              <div className="relative h-48 sm:h-56 overflow-hidden">
                <img
                  src={hotel.image}
                  alt={hotel.name}
                  className="w-full h-full object-cover transform hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute top-0 right-0 m-4">
                  <span className="px-2 py-1 bg-blue-600/90 text-white text-sm font-medium rounded-md backdrop-blur-sm">
                    {hotel.code}
                  </span>
                </div>
              </div>
              <div className="p-6 flex flex-col flex-grow">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
                  {hotel.name}
                </h2>
                <p className="text-gray-600 dark:text-gray-400 text-sm mb-4 flex-grow overflow-hidden">
                  {hotel.description}
                </p>
                <div className="flex items-start space-x-2 text-gray-500 dark:text-gray-400 text-sm mb-4">
                  <MapPin className="h-5 w-5 flex-shrink-0 mt-0.5" />
                  <span className="overflow-hidden overflow-ellipsis">{hotel.address}</span>
                </div>
                <button
                  onClick={() => handleSelectHotel(hotel)}
                  className="w-full flex items-center justify-center px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all duration-200 transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
                >
                  <span className="font-medium">Acessar Sistema</span>
                  <ArrowRight className="ml-2 h-5 w-5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default HotelSelection;