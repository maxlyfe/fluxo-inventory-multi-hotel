export interface Hotel {
  id: string;
  name: string;
  code: string;
  image: string;
  address: string;
  description: string;
  fantasy_name?: string;
  corporate_name?: string;
  cnpj?: string;

export interface HotelGroup {
  id: string;
  name: string;
  hotels: Hotel[];
}
