// src/pages/PublicSectorsPage.tsx
// Página pública de acesso às requisições por setor — design kiosk/mobile.

import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useHotel } from '../context/HotelContext';
import {
  Package, Loader2, AlertCircle, Search, ArrowLeft,
  UtensilsCrossed, Wrench, Sparkles, CalendarDays,
  DollarSign, BarChart2, ShoppingCart, Shirt, Coffee,
  Dumbbell, Waves, Trees, Car, Tv2, ClipboardList,
  ChefHat, Wine, Users, Building2, Megaphone,
} from 'lucide-react';

// ── Ícone automático por nome do setor ──────────────────────────────────────
function sectorIcon(name: string) {
  const n = name.toLowerCase();
  if (/cozinha|restaurante|food/i.test(n))       return ChefHat;
  if (/bar|bebida|drink/i.test(n))               return Wine;
  if (/manuten/i.test(n))                        return Wrench;
  if (/governan|limpeza|housekeeping/i.test(n))  return Sparkles;
  if (/evento|event/i.test(n))                   return CalendarDays;
  if (/financ|contab/i.test(n))                  return DollarSign;
  if (/gerenc|diretor|admin/i.test(n))           return BarChart2;
  if (/compra|estoque|almoxar/i.test(n))         return ShoppingCart;
  if (/roupa|lavand|uniform/i.test(n))           return Shirt;
  if (/café|cafeter/i.test(n))                   return Coffee;
  if (/acad|fitness|gym/i.test(n))               return Dumbbell;
  if (/piscina|spa|água/i.test(n))               return Waves;
  if (/jardim|área|externa/i.test(n))            return Trees;
  if (/valet|estacion|garagem/i.test(n))         return Car;
  if (/ti|tecnologia|inform/i.test(n))           return Tv2;
  if (/recep/i.test(n))                          return ClipboardList;
  if (/rh|recursos|pessoal/i.test(n))            return Users;
  if (/marketing|comunic/i.test(n))              return Megaphone;
  if (/hotel|geral|operac/i.test(n))             return Building2;
  if (/produ/i.test(n))                          return UtensilsCrossed;
  return Package;
}

// Paleta de fallback — usado quando setor não tem cor definida
const PALETTE = [
  '#6366f1','#0ea5e9','#10b981','#f59e0b','#ef4444',
  '#8b5cf6','#14b8a6','#f97316','#ec4899','#06b6d4',
];

interface Sector { id: string; name: string; color: string | null; }

export default function PublicSectorsPage() {
  const { selectedHotel } = useHotel();
  const navigate = useNavigate();

  const [sectors,  setSectors]  = useState<Sector[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [search,   setSearch]   = useState('');
  const [time,     setTime]     = useState(new Date());

  // Relógio
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!selectedHotel?.id) { navigate('/select-hotel', { replace: true }); return; }
    supabase
      .from('sectors')
      .select('id, name, color')
      .eq('hotel_id', selectedHotel.id)
      .order('name')
      .then(({ data, error: err }) => {
        if (err) setError('Não foi possível carregar os setores.');
        else setSectors(data ?? []);
        setLoading(false);
      });
  }, [selectedHotel?.id, navigate]);

  const filtered = useMemo(() =>
    sectors.filter(s => s.name.toLowerCase().includes(search.toLowerCase())),
    [sectors, search]
  );

  const fmtTime = time.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const fmtDate = time.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'linear-gradient(160deg, #0f172a 0%, #1e293b 60%, #0f172a 100%)',
      fontFamily: "'Inter', sans-serif",
      color: '#f8fafc',
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        @keyframes spin  { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.6; } }
        .ps-card {
          transition: transform 0.18s ease, box-shadow 0.18s ease;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }
        .ps-card:hover  { transform: translateY(-4px) scale(1.02); }
        .ps-card:active { transform: scale(0.97); }
        .ps-search:focus { outline: none; border-color: rgba(99,102,241,0.6) !important; }
      `}</style>

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div style={{
        padding: '1.25rem 1.5rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(148,163,184,0.08)',
        backdropFilter: 'blur(12px)',
        background: 'rgba(15,23,42,0.7)',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <button
          onClick={() => navigate('/select-hotel')}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '0.45rem 0.9rem', borderRadius: 10,
            border: '1px solid rgba(148,163,184,0.15)',
            background: 'rgba(148,163,184,0.07)',
            color: '#94a3b8', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>
          <ArrowLeft size={14} /> Trocar hotel
        </button>

        {/* Relógio */}
        <div style={{ textAlign: 'right' }}>
          <p style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: -0.5, color: '#f1f5f9', lineHeight: 1 }}>{fmtTime}</p>
          <p style={{ margin: 0, fontSize: 11, color: '#64748b', textTransform: 'capitalize' }}>{fmtDate}</p>
        </div>
      </div>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div style={{ textAlign: 'center', padding: '2.5rem 1.5rem 1.5rem', animation: 'fadeUp 0.5s ease' }}>
        {/* Badge hotel */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '0.4rem 1rem', borderRadius: 99,
          background: 'rgba(99,102,241,0.15)',
          border: '1px solid rgba(99,102,241,0.3)',
          marginBottom: '1rem',
        }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#6366f1', animation: 'pulse 2s infinite' }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: '#a5b4fc', letterSpacing: 0.5, textTransform: 'uppercase' }}>
            {selectedHotel?.name ?? '—'}
          </span>
        </div>

        <h1 style={{ margin: '0 0 0.5rem', fontSize: 'clamp(1.6rem, 5vw, 2.2rem)', fontWeight: 900, letterSpacing: -1, color: '#f8fafc' }}>
          Olá! Qual é o seu setor?
        </h1>
        <p style={{ margin: 0, fontSize: 15, color: '#64748b', fontWeight: 500 }}>
          Selecione para abrir o formulário de requisição
        </p>
      </div>

      {/* ── Search ───────────────────────────────────────────────────────── */}
      {sectors.length > 6 && !loading && (
        <div style={{ maxWidth: 480, margin: '0 auto 1.5rem', padding: '0 1.5rem', animation: 'fadeUp 0.5s ease 0.1s both' }}>
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#64748b', pointerEvents: 'none' }} />
            <input
              className="ps-search"
              placeholder="Buscar setor..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '0.75rem 1rem 0.75rem 2.5rem',
                borderRadius: 14, fontSize: 14, fontWeight: 500,
                border: '1px solid rgba(148,163,184,0.15)',
                background: 'rgba(30,41,59,0.7)',
                color: '#f1f5f9',
                backdropFilter: 'blur(8px)',
              }}
            />
          </div>
        </div>
      )}

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 1.25rem 3rem' }}>

        {/* Loading */}
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '5rem', color: '#64748b' }}>
            <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: '#6366f1' }} />
            <span style={{ fontWeight: 600, fontSize: 15 }}>Carregando setores...</span>
          </div>
        )}

        {/* Erro */}
        {error && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '1rem 1.25rem', borderRadius: 14,
            background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.3)',
            color: '#fca5a5', fontSize: 14, fontWeight: 600,
          }}>
            <AlertCircle size={18} color="#f43f5e" /> {error}
          </div>
        )}

        {/* Empty */}
        {!loading && !error && sectors.length === 0 && (
          <div style={{ textAlign: 'center', padding: '5rem', color: '#475569' }}>
            <Package size={48} style={{ marginBottom: 16, opacity: 0.3 }} />
            <p style={{ fontWeight: 700, fontSize: 16, margin: 0 }}>Nenhum setor cadastrado.</p>
            <p style={{ fontSize: 13, margin: '8px 0 0', color: '#334155' }}>Contacte o administrador do sistema.</p>
          </div>
        )}

        {/* No results after search */}
        {!loading && !error && sectors.length > 0 && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#475569' }}>
            <Search size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
            <p style={{ fontWeight: 600, margin: 0 }}>Nenhum setor encontrado para "{search}".</p>
          </div>
        )}

        {/* Grid de setores */}
        {!loading && filtered.length > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 200px), 1fr))',
            gap: '1rem',
          }}>
            {filtered.map((sector, i) => {
              const color = sector.color || PALETTE[i % PALETTE.length];
              const Icon  = sectorIcon(sector.name);
              return (
                <Link
                  key={sector.id}
                  to={`/sector/${sector.id}`}
                  style={{ textDecoration: 'none' }}>
                  <div
                    className="ps-card"
                    style={{
                      borderRadius: 20,
                      background: 'rgba(30,41,59,0.6)',
                      border: `1px solid rgba(148,163,184,0.1)`,
                      backdropFilter: 'blur(12px)',
                      padding: '1.75rem 1.25rem 1.5rem',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
                      animation: `fadeUp 0.4s ease ${i * 0.04}s both`,
                      boxShadow: `0 0 0 0 ${color}00`,
                      minHeight: 160,
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLDivElement).style.boxShadow = `0 8px 30px -8px ${color}55, 0 0 0 1px ${color}44`;
                      (e.currentTarget as HTMLDivElement).style.borderColor = color + '66';
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
                      (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(148,163,184,0.1)';
                    }}
                  >
                    {/* Ícone */}
                    <div style={{
                      width: 64, height: 64, borderRadius: 18,
                      background: `linear-gradient(135deg, ${color}33, ${color}18)`,
                      border: `1.5px solid ${color}44`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: `0 4px 16px -4px ${color}44`,
                    }}>
                      <Icon size={28} color={color} strokeWidth={1.8} />
                    </div>

                    {/* Nome */}
                    <p style={{
                      margin: 0, fontWeight: 700, fontSize: 14,
                      color: '#f1f5f9', textAlign: 'center', lineHeight: 1.3,
                    }}>
                      {sector.name}
                    </p>

                    {/* Tap indicator */}
                    <div style={{
                      padding: '0.25rem 0.75rem', borderRadius: 99,
                      background: color + '20',
                      fontSize: 11, fontWeight: 700, color: color,
                      letterSpacing: 0.4, textTransform: 'uppercase',
                    }}>
                      Selecionar
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer discreto */}
      <div style={{ textAlign: 'center', padding: '1rem', borderTop: '1px solid rgba(148,163,184,0.06)' }}>
        <p style={{ margin: 0, fontSize: 11, color: '#1e293b', fontWeight: 500 }}>
          LyFe Hoteles · Sistema de Requisições
        </p>
      </div>
    </div>
  );
}
