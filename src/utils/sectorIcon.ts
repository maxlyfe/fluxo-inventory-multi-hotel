// src/utils/sectorIcon.ts
// Mapeamento automático de ícone por nome de setor.
// Retorna { icon: ComponentType, iconName: string } para uso em UI e em widgets do dashboard.

import {
  Package, ChefHat, Wine, Wrench, Sparkles, CalendarDays,
  DollarSign, BarChart2, ShoppingCart, Shirt, Coffee,
  Dumbbell, Waves, Trees, Car, Tv2, ClipboardList,
  Users, Building2, Megaphone, UtensilsCrossed,
} from 'lucide-react';
import type { ComponentType } from 'react';

interface SectorIconResult {
  icon:     ComponentType<any>;
  iconName: string;
}

const SECTOR_ICON_MAP: Array<{ pattern: RegExp; icon: ComponentType<any>; name: string }> = [
  { pattern: /cozinha|restaurante|food/i,        icon: ChefHat,        name: 'ChefHat'        },
  { pattern: /bar|bebida|drink/i,                icon: Wine,           name: 'Wine'           },
  { pattern: /manuten/i,                         icon: Wrench,         name: 'Wrench'         },
  { pattern: /governan|limpeza|housekeeping/i,   icon: Sparkles,       name: 'Sparkles'       },
  { pattern: /evento|event/i,                    icon: CalendarDays,   name: 'CalendarDays'   },
  { pattern: /financ|contab/i,                   icon: DollarSign,     name: 'DollarSign'     },
  { pattern: /gerenc|diretor|admin/i,            icon: BarChart2,      name: 'BarChart2'      },
  { pattern: /compra|estoque|almoxar/i,          icon: ShoppingCart,   name: 'ShoppingCart'   },
  { pattern: /roupa|lavand|uniform/i,            icon: Shirt,          name: 'Shirt'          },
  { pattern: /café|cafeter/i,                    icon: Coffee,         name: 'Coffee'         },
  { pattern: /acad|fitness|gym/i,                icon: Dumbbell,       name: 'Dumbbell'       },
  { pattern: /piscina|spa|água/i,                icon: Waves,          name: 'Waves'          },
  { pattern: /jardim|área|externa/i,             icon: Trees,          name: 'Trees'          },
  { pattern: /valet|estacion|garagem/i,          icon: Car,            name: 'Car'            },
  { pattern: /ti|tecnologia|inform/i,            icon: Tv2,            name: 'Tv2'            },
  { pattern: /recep/i,                           icon: ClipboardList,  name: 'ClipboardList'  },
  { pattern: /rh|recursos|pessoal/i,             icon: Users,          name: 'Users'          },
  { pattern: /marketing|comunic/i,               icon: Megaphone,      name: 'Megaphone'      },
  { pattern: /hotel|geral|operac/i,              icon: Building2,      name: 'Building2'      },
  { pattern: /produ/i,                           icon: UtensilsCrossed,name: 'UtensilsCrossed'},
];

export function sectorIcon(name: string): SectorIconResult {
  for (const entry of SECTOR_ICON_MAP) {
    if (entry.pattern.test(name)) {
      return { icon: entry.icon, iconName: entry.name };
    }
  }
  return { icon: Package, iconName: 'Package' };
}
