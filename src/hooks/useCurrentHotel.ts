import { useHotel } from '../context/HotelContext';

export const useCurrentHotel = () => {
  const { selectedHotel } = useHotel();
  return selectedHotel?.id;
};