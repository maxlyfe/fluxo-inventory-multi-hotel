import { useState, useEffect } from 'react';
import { useHotel } from '../context/HotelContext';
import { supabase } from '../lib/supabase';

export const useHotelData = (tableName: string, options = {}) => {
  const { selectedHotel } = useHotel();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!selectedHotel) return;

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        let query = supabase
          .from(tableName)
          .select(options.select || '*')
          .eq('hotel_id', selectedHotel.id);

        if (options.order) {
          query = query.order(options.order.column, options.order);
        }

        const { data, error } = await query;

        if (error) throw error;
        setData(data);
      } catch (err) {
        console.error(`Error fetching ${tableName}:`, err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();

    // Set up real-time subscription if enabled
    if (options.subscribe) {
      const channel = supabase
        .channel(`${tableName}_changes`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: tableName,
            filter: `hotel_id=eq.${selectedHotel.id}`
          },
          () => {
            fetchData();
          }
        )
        .subscribe();

      return () => {
        channel.unsubscribe();
      };
    }
  }, [selectedHotel, tableName, options]);

  return { data, loading, error };
};