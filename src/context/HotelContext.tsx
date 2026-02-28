import React, { createContext, useContext, useState, useEffect } from 'react';
import { Hotel } from '../types/hotel';
import { supabase } from '../lib/supabase';

interface HotelContextType {
  selectedHotel: Hotel | null;
  setSelectedHotel: (hotel: Hotel | null) => void;
  loading: boolean;
  error: string | null;
}

const HotelContext = createContext<HotelContextType | undefined>(undefined);

export const useHotel = () => {
  const context = useContext(HotelContext);
  if (context === undefined) {
    throw new Error('useHotel must be used within a HotelProvider');
  }
  return context;
};

export function HotelProvider({ children }: { children: React.ReactNode }) {
  const [selectedHotel, setSelectedHotel] = useState<Hotel | null>(() => {
    const stored = localStorage.getItem('selectedHotel');
    return stored ? JSON.parse(stored) : null;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedHotel) {
      localStorage.setItem('selectedHotel', JSON.stringify(selectedHotel));
      
      // Verify hotel exists in database using UUID
      const verifyHotel = async () => {
        try {
          setLoading(true);
          const { data, error } = await supabase
            .from('hotels')
            .select('id, name, code, fantasy_name, corporate_name, cnpj')
            .eq('id', selectedHotel.id)
            .single();

          if (error || !data) {
            console.error('Hotel verification error:', error);
            setSelectedHotel(null);
            localStorage.removeItem('selectedHotel');
            setError('Hotel não encontrado no banco de dados');
          }
        } catch (err) {
          console.error('Error verifying hotel:', err);
          setError('Erro ao verificar hotel');
        } finally {
          setLoading(false);
        }
      };

      verifyHotel();
    } else {
      localStorage.removeItem('selectedHotel');
    }
  }, [selectedHotel]);

  return (
    <HotelContext.Provider value={{ selectedHotel, setSelectedHotel, loading, error }}>
      {children}
    </HotelContext.Provider>
  );
}
