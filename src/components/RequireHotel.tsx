import React from 'react';
import { Navigate } from 'react-router-dom';
import { useHotel } from '../context/HotelContext';

const RequireHotel = ({ children }: { children: React.ReactNode }) => {
  const { selectedHotel } = useHotel();

  if (!selectedHotel) {
    // Redirect them to the /select-hotel page, but save the current location they were
    // trying to go to when they were redirected. This allows us to send them
    // along to that page after they select a hotel.
    return <Navigate to="/select-hotel" replace />;
  }

  return <>{children}</>;
};

export default RequireHotel;

