import classNames from 'classnames';
import React, { useState, useEffect, Fragment } from "react"; // Fragment já estava aqui, ótimo.
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Menu, Transition } from '@headlessui/react'; // Adicionando importação do Headless UI
import { supabase } from "../lib/supabase"; // Ajuste o caminho se necessÃ¡rio
import NotificationBell from "./NotificationBell";
import { useAuth } from "../context/AuthContext";
import { useHotel } from "../context/HotelContext";
import { useTheme } from "../context/ThemeContext"; // Import useTheme

import {
  Hotel as HotelIcon,
  Users as UsersIcon,
  Building2 as BuildingIcon,
  LogOut as LogOutIcon,
  SunMedium as SunIcon, // Import SunIcon from lucide-react
  Moon as MoonIcon, // Import MoonIcon from lucide-react
  Menu as MenuIconLucide, // Renomeando para evitar conflito com Menu do Headless UI
  X as XIcon, // Import XIcon for mobile
  Settings as SettingsIcon, // Import SettingsIcon for profile menu
  UserCircle2 as ProfileIcon, // Import ProfileIcon for profile menu
  LayoutDashboard as DashboardIcon, // Import DashboardIcon
  ClipboardList as RequisicoesIcon, // Import RequisicoesIcon
  FileText as OrcamentosIcon, // Import OrcamentosIcon
  Briefcase as AlmoxarifadoIcon, // Import AlmoxarifadoIcon
  ShoppingCart as ComprasIcon, // Import ComprasIcon
  DollarSign as FinanceiroIcon, // Import FinanceiroIcon
  ConciergeBell as RecepcaoIcon, // Import RecepcaoIcon
  Utensils as RestauranteIcon, // Import RestauranteIcon
  BedDouble as GovernancaIcon, // Import GovernancaIcon
  Wrench as ManutencaoIcon, // Import ManutencaoIcon
  UsersRound as UserManagementIcon, // Import UserManagementIcon
} from "lucide-react";

const hotelNameMapping = {
  "Costa do Sol Boutique Hotel": "CS",
  "Brava Club": "BC",
  "Villa Pitanga": "VP",
  "Maria Maria": "MM",
};

const Navbar = () => {
  const { user, logout: authLogout } = useAuth();
  const { selectedHotel, setSelectedHotel, hotelId } = useHotel(); 
  const { theme, toggleTheme } = useTheme(); 
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [hotelDisplayName, setHotelDisplayName] = useState("");

  useEffect(() => {
    const currentHotelName = selectedHotel?.name || "Hotel";
    setHotelDisplayName(hotelNameMapping[currentHotelName] || currentHotelName);
  }, [selectedHotel]);

  const handleSignOut = async () => {
    const { success } = await authLogout();
    if (success) {
      navigate("/login");
    } else {
      console.error("Falha ao fazer logout");
    }
  };

  const handleChangeHotel = () => {
    setSelectedHotel(null);
    navigate("/select-hotel");
  };

  const navigationItems = [
    { name: "Dashboard", href: "/", icon: DashboardIcon, roles: ["admin", "management", "inventory", "sup-governanca", "almoxarifado", "compras", "financeiro", "recepcao", "restaurante", "governanca", "manutencao"] },
    { name: "Requisições", href: "/admin", icon: RequisicoesIcon, roles: ["admin", "management", "inventory", "sup-governanca", "almoxarifado", "compras", "financeiro", "recepcao", "restaurante", "governanca", "manutencao"] },
    { name: "Orçamentos", href: "/budget-history", icon: OrcamentosIcon, roles: ["admin", "management", "sup-governanca", "compras"] },
    { name: "Aprovações", href: "/authorizations", icon: ComprasIcon, roles: ["admin", "management", "sup-governanca", "compras"] }, 
    { name: "Usuários", href: "/users", icon: UserManagementIcon, roles: ["admin", "sup-governanca"] }, 
  ];

  const filteredNavigation = navigationItems.filter(
    (item) => user?.role && item.roles.includes(user.role)
  );

  if (!user) {
    return null;
  }

  return (
    <nav className={`bg-white dark:bg-gray-900 shadow-md w-full z-50`}>
      <div className="mx-auto px-2 sm:px-4 lg:px-6">
        <div className="relative flex items-center justify-between h-16">
          <div className="flex items-center flex-shrink-0">
            <Link to="/" className="flex items-center space-x-2">
              <HotelIcon className="h-7 w-7 text-blue-600 dark:text-blue-400 flex-shrink-0" />
              <span className="text-base sm:text-lg font-semibold text-gray-800 dark:text-white whitespace-nowrap truncate">
                {hotelDisplayName} 
              </span>
            </Link>
            <button
              onClick={handleChangeHotel}
              className="ml-2 p-1.5 rounded-md text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center space-x-1 whitespace-nowrap flex-shrink-0"
              title="Trocar Hotel"
            >
              <BuildingIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Trocar Hotel</span>
            </button>
          </div>

          <div className="hidden lg:flex flex-grow justify-center px-2">
            <div className="flex items-baseline space-x-1">
              {filteredNavigation.map((item) => (
                <Link
                  key={item.name}
                  to={item.href}
                  className={classNames(
                    location.pathname === item.href
                      ? "bg-blue-600 text-white dark:bg-blue-700"
                      : "text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white",
                    "px-2 py-2 rounded-md text-xs xl:text-sm font-medium flex items-center space-x-1 xl:space-x-2 whitespace-nowrap"
                  )}
                  aria-current={location.pathname === item.href ? "page" : undefined}
                >
                  <item.icon className="h-4 w-4 xl:h-5 xl:w-5 flex-shrink-0" />
                  <span className="hidden xl:inline">{item.name}</span>
                  <span className="xl:hidden">{item.name.substring(0,3)}</span>
                </Link>
              ))}
            </div>
          </div>

          <div className="flex items-center space-x-1 sm:space-x-2 flex-shrink-0">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-full text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
              aria-label="Alternar tema"
            >
              {theme === "light" ? (
                <MoonIcon className="h-5 w-5" />
              ) : (
                <SunIcon className="h-5 w-5" />
              )}
            </button>

            <NotificationBell />
            
            <div className="relative">
              <Menu as="div" className="relative">
                <Menu.Button 
                  className="p-2 rounded-full text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 lg:hidden"
                  onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                >
                  <span className="sr-only">Abrir menu</span>
                  {mobileMenuOpen ? <XIcon className="h-6 w-6" /> : <MenuIconLucide className="h-6 w-6" />}
                </Menu.Button>
                
                <div className="hidden lg:block">
                    <Menu.Button className="flex text-sm rounded-full focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-800">
                        <span className="sr-only">Abrir menu do usuário</span>
                        <img
                        className="h-8 w-8 rounded-full"
                        src={`https://ui-avatars.com/api/?name=${user.email || "U"}&background=random&color=fff`}
                        alt="Avatar"
                        />
                    </Menu.Button>
                </div>

                <Transition
                    as={Fragment}
                    enter="transition ease-out duration-100"
                    enterFrom="transform opacity-0 scale-95"
                    enterTo="transform opacity-100 scale-100"
                    leave="transition ease-in duration-75"
                    leaveFrom="transform opacity-100 scale-100"
                    leaveTo="transform opacity-0 scale-95"
                  >
                    <Menu.Items className="origin-top-right absolute right-0 mt-2 w-56 rounded-md shadow-lg bg-white dark:bg-gray-800 ring-1 ring-black dark:ring-gray-700 ring-opacity-5 focus:outline-none z-50">
                      <div className="py-1">
                        <div className="px-4 py-3">
                          <p className="text-sm text-gray-900 dark:text-white">Logado como</p>
                          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
                            {user.email}
                          </p>
                        </div>
                        <Menu.Item>
                          {({ active }) => (
                            <Link
                              to="/profile" 
                              className={classNames(
                                active ? "bg-gray-100 dark:bg-gray-700" : "",
                                "block px-4 py-2 text-sm text-gray-700 dark:text-gray-200 w-full text-left flex items-center space-x-2"
                              )}
                              onClick={() => setMobileMenuOpen(false)}
                            >
                              <ProfileIcon className="h-5 w-5" />
                              <span>Seu Perfil</span>
                            </Link>
                          )}
                        </Menu.Item>
                        <Menu.Item>
                          {({ active }) => (
                            <Link
                              to="/settings" 
                              className={classNames(
                                active ? "bg-gray-100 dark:bg-gray-700" : "",
                                "block px-4 py-2 text-sm text-gray-700 dark:text-gray-200 w-full text-left flex items-center space-x-2"
                              )}
                               onClick={() => setMobileMenuOpen(false)}
                            >
                              <SettingsIcon className="h-5 w-5" />
                              <span>Configurações</span>
                            </Link>
                          )}
                        </Menu.Item>
                        <Menu.Item>
                          {({ active }) => (
                            <button
                              onClick={() => { handleSignOut(); setMobileMenuOpen(false); }}
                              className={classNames(
                                active ? "bg-gray-100 dark:bg-gray-700" : "",
                                "block w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 flex items-center space-x-2"
                              )}
                            >
                              <LogOutIcon className="h-5 w-5" />
                              <span>Sair</span>
                            </button>
                          )}
                        </Menu.Item>
                      </div>
                    </Menu.Items>
                  </Transition>
                </Menu>
              </div>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="lg:hidden absolute top-16 left-0 w-full bg-white dark:bg-gray-900 shadow-lg pb-3 z-40">
            <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3">
              {filteredNavigation.map((item) => (
                <Link
                  key={item.name}
                  to={item.href}
                  className={classNames(
                    location.pathname === item.href
                      ? "bg-blue-600 text-white dark:bg-blue-700"
                      : "text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white",
                    "block px-3 py-2 rounded-md text-base font-medium flex items-center space-x-2"
                  )}
                  aria-current={location.pathname === item.href ? "page" : undefined}
                  onClick={() => setMobileMenuOpen(false)} 
                >
                  <item.icon className="h-5 w-5" />
                  <span>{item.name}</span>
                </Link>
              ))}
            </div>
            <div className="pt-4 pb-3 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center px-5">
                <div className="flex-shrink-0">
                  <img
                    className="h-10 w-10 rounded-full"
                    src={`https://ui-avatars.com/api/?name=${user.email || "U"}&background=random&color=fff`}
                    alt="Avatar"
                  />
                </div>
                <div className="ml-3">
                  <div className="text-base font-medium text-gray-900 dark:text-white">
                    {user.email?.split("@")[0]}
                  </div>
                  <div className="text-sm font-medium text-gray-500 dark:text-gray-400">
                    {user.email}
                  </div>
                </div>
              </div>
              <div className="mt-3 px-2 space-y-1">
                <Link
                  to="/profile" 
                  className="block px-3 py-2 rounded-md text-base font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center space-x-2"
                  onClick={() => setMobileMenuOpen(false)} 
                >
                  <ProfileIcon className="h-5 w-5" />
                  <span>Seu Perfil</span>
                </Link>
                <Link
                  to="/settings" 
                  className="block px-3 py-2 rounded-md text-base font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center space-x-2"
                  onClick={() => setMobileMenuOpen(false)} 
                >
                  <SettingsIcon className="h-5 w-5" />
                  <span>Configurações</span>
                </Link>
                <button
                  onClick={() => { handleSignOut(); setMobileMenuOpen(false); }}
                  className="block w-full text-left px-3 py-2 rounded-md text-base font-medium text-red-600 dark:text-red-400 hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center space-x-2"
                >
                  <LogOutIcon className="h-5 w-5" />
                  <span>Sair</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navbar;

