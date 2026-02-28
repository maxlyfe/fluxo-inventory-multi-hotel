import { HotelGroup } from '../types/hotel';

export const hotelGroup: HotelGroup = {
  id: 'meridiana-hoteles',
  name: 'Meridiana Hoteles',
  hotels: [
    {
      id: '11111111-1111-1111-1111-111111111111',
      code: 'CS',
      name: 'Costa do Sol Boutique Hotel',
      image: 'https://lirp.cdn-website.com/d1ba3a80/dms3rep/multi/opt/cds-estrutura-13-1920w.jpg',
      address: 'Rua Neli da Costa Carvalho, 595 - Alto da Brava',
      description: 'Costa do Sol Boutique traz um novo conceito em hospedagem para a península. Sua localização privilegiada no Alto da Brava, a apenas 5 minutos do centro onde estão localizadas as melhores lojas e restaurantes da cidade.'
    },
    {
      id: '22222222-2222-2222-2222-222222222222',
      code: 'BC',
      name: 'Brava Club',
      image: 'https://media.omnibees.com/Images/2825/RoomTypes/640x426/240209.jpg',
      address: 'Rua Geraldo de Jesus, 567 - Praia Brava',
      description: 'Quem nunca sonhou em acordar e poder admirar o mar? Quem nunca desejou viver próximo a toda a exuberância da natureza? Aqui no Brava Club, você pode ter um aperitivo dessa incrível sensação.'
    },
    {
      id: '33333333-3333-3333-3333-333333333333',
      code: 'MM',
      name: 'Maria Maria',
      image: 'https://lirp.cdn-website.com/adb40c2b/dms3rep/multi/opt/Sequ%C3%AAncia+02.00_00_06_14.Quadro020-1920w.jpg',
      address: 'Avenida Roberto Improta Saraiva, 06 - Ferradura',
      description: 'A Pousada Maria Maria possui uma localização privilegiada a cerca de 800m da praia da Ferradura e 500m do Centro da cidade.'
    },
    {
      id: '44444444-4444-4444-4444-444444444444',
      code: 'VLP',
      name: 'Villa Pitanga',
      image: 'https://lirp.cdn-website.com/adb40c2b/dms3rep/multi/opt/pousada-vila-pitanga-fbe27352-1920w.jpg',
      address: 'Rua Maria Leontina Franco da Costa, 07 - Ferradura',
      description: 'Localizada no bairro mais exclusivo da península de Búzios, Ferradura, próxima à praia e à charmosa Rua das Pedras, a Pousada Vila Pitanga oferece um ambiente em total harmonia com a natureza.'
    }
  ]
};