import React, { useState, useEffect } from 'react';
import { 
  Sun, Sparkles, Moon, Clock, MapPin, 
  Droplets, Wind, Cloud, CloudFog, CloudDrizzle, 
  CloudRain, CloudSnow, CloudLightning 
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAuth } from '../../context/AuthContext';

// ---------------------------------------------------------------------------
// Helpers (extraídos da Home original)
// ---------------------------------------------------------------------------
function getGreeting(): { text: string; sub: string; icon: React.ComponentType<any>; gradient: string } {
  const h = new Date().getHours();
  if (h < 12) return { text: 'Bom dia',   sub: 'Que o dia seja produtivo!',      icon: Sun,   gradient: 'from-amber-400 via-orange-400 to-rose-400' };
  if (h < 18) return { text: 'Boa tarde', sub: 'Tudo sob controle por aqui?',    icon: Sparkles, gradient: 'from-blue-400 via-indigo-400 to-violet-400' };
  return          { text: 'Boa noite',  sub: 'Encerrando mais um dia de sucesso.', icon: Moon,  gradient: 'from-indigo-500 via-violet-500 to-purple-500' };
}

function getWeatherInfo(code: number): { label: string; icon: React.ComponentType<any>; color: string } {
  if (code === 0)   return { label: 'Céu limpo',        icon: Sun,            color: '#f59e0b' };
  if (code <= 3)    return { label: 'Parcial nublado',  icon: Cloud,          color: '#64748b' };
  if (code <= 48)   return { label: 'Nevoeiro',         icon: CloudFog,       color: '#94a3b8' };
  if (code <= 55)   return { label: 'Chuvisco',         icon: CloudDrizzle,   color: '#0ea5e9' };
  if (code <= 57)   return { label: 'Chuvisco gelo',    icon: CloudDrizzle,   color: '#06b6d4' };
  if (code <= 65)   return { label: 'Chuva',            icon: CloudRain,      color: '#3b82f6' };
  if (code <= 67)   return { label: 'Chuva gelada',     icon: CloudRain,      color: '#0284c7' };
  if (code <= 77)   return { label: 'Neve',             icon: CloudSnow,      color: '#e2e8f0' };
  if (code <= 82)   return { label: 'Pancadas',         icon: CloudRain,      color: '#2563eb' };
  if (code <= 86)   return { label: 'Neve forte',       icon: CloudSnow,      color: '#cbd5e1' };
  if (code <= 99)   return { label: 'Trovoada',         icon: CloudLightning, color: '#7c3aed' };
  return { label: 'Indefinido', icon: Cloud, color: '#94a3b8' };
}

const BUZIOS_LAT = -22.75;
const BUZIOS_LON = -41.88;

export default function GreetingWidget() {
  const { user } = useAuth();
  const [weather, setWeather] = useState<any>(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchWeather = async () => {
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${BUZIOS_LAT}&longitude=${BUZIOS_LON}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index,visibility&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=America/Sao_Paulo&forecast_days=4`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const c = data.current; const d = data.daily;
        setWeather({
          temperature: c.temperature_2m, feelsLike: c.apparent_temperature,
          humidity: c.relative_humidity_2m, windSpeed: c.wind_speed_10m,
          weatherCode: c.weather_code,
          daily: (d.time as string[]).slice(1).map((date: string, i: number) => ({
            date, tempMax: d.temperature_2m_max[i + 1],
            tempMin: d.temperature_2m_min[i + 1], weatherCode: d.weather_code[i + 1],
          })),
        });
      } catch { /* silent */ }
    };
    fetchWeather();
    return () => { cancelled = true; };
  }, []);

  const greeting = getGreeting();
  const GreetingIcon = greeting.icon;
  const w = weather ? getWeatherInfo(weather.weatherCode) : null;
  const WeatherIcon = w?.icon;

  return (
    <div className={`relative overflow-hidden rounded-3xl bg-gradient-to-br ${greeting.gradient} p-6 sm:p-8 shadow-xl w-full`}>
      <div className="absolute inset-0 bg-black/10" />
      <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-white/5 blur-3xl pointer-events-none" />
      
      <div className="relative z-10 flex flex-col sm:flex-row sm:items-start gap-5">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center border border-white/20">
              <GreetingIcon className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-black text-white leading-none">
                {greeting.text}{user?.full_name ? `, ${user.full_name.split(' ')[0]}` : ''}
              </h1>
              <p className="text-white/70 text-sm mt-0.5">{greeting.sub}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 mt-4">
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/15 border border-white/20 text-white text-xs font-semibold backdrop-blur-sm capitalize">
              {format(new Date(), "EEEE, d 'de' MMMM", { locale: ptBR })}
            </span>
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/15 border border-white/20 text-white text-xs font-bold backdrop-blur-sm font-mono tabular-nums">
              <Clock className="w-3 h-3" />
              {format(currentTime, 'HH:mm')}
            </span>
          </div>
        </div>

        {weather && w && WeatherIcon && (
          <div className="shrink-0 rounded-2xl bg-white/10 border border-white/20 backdrop-blur-md p-4 min-w-[180px]">
            <div className="flex items-center gap-3 mb-3">
              <WeatherIcon className="w-8 h-8 text-white drop-shadow-lg" />
              <div>
                <p className="text-3xl font-black text-white leading-none tabular-nums">
                  {Math.round(weather.temperature)}°
                </p>
                <p className="text-white/70 text-xs mt-0.5">{w.label}</p>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[11px] text-white/70">
                <Droplets className="w-3 h-3 text-cyan-300" />
                {weather.humidity}% · Sensação {Math.round(weather.feelsLike)}°
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-white/70">
                <Wind className="w-3 h-3 text-blue-200" />
                {Math.round(weather.windSpeed)} km/h
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
