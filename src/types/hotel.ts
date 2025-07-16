export interface Hotel {
  id: string;
  name: string;
  code: string;
  image: string;
  address: string;
  description: string;
}

export interface HotelGroup {
  id: string;
  name: string;
  hotels: Hotel[];
}