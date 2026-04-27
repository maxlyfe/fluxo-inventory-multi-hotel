// src/pages/PublicSectorsPage.tsx
// Página pública de acesso às requisições por setor.
// Acessada por colaboradores sem login — permite selecionar o setor
// e abrir o formulário de requisição em /sector/:id.

import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useHotel } from '../context/HotelContext';
import { Package, ChevronRight, ArrowLeft, Loader2, AlertCircle, Grid3x3 } from 'lucide-react';

interface Sector {
  id: string;
  name: string;
  color: string | null;
}

export default function PublicSectorsPage() {
  const { selectedHotel } = useHotel();
  const navigate = useNavigate();

  const [sectors, setSectors]   = useState<Sector[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');

  useEffect(() => {
    if (!selectedHotel?.id) {
      navigate('/select-hotel', { replace: true });
      return;
    }
    supabase
      .from('sectors')
      .select('id, name, color')
      .eq('hotel_id', selectedHotel.id)
      .eq('is_active', true)
      .order('name')
      .then(({ data, error: err }) => {
        if (err) setError('Não foi possível carregar os setores.');
        else setSectors(data ?? []);
        setLoading(false);
      });
  }, [selectedHotel?.id, navigate]);

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'Inter, sans-serif' }}>

      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={() => navigate('/select-hotel')}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.4rem 0.8rem', borderRadius: 8, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#64748b', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          <ArrowLeft size={14} /> Trocar hotel
        </button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <p style={{ margin: 0, fontWeight: 800, fontSize: 16, color: '#1e293b' }}>
            {selectedHotel?.name ?? '—'}
          </p>
          <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>Selecione o seu setor</p>
        </div>
        {/* spacer para centralizar o título */}
        <div style={{ width: 90 }} />
      </div>

      {/* Body */}
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '2rem 1.5rem' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1.5rem' }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg,#6366f1,#4f46e5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Grid3x3 size={20} color="#fff" />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#1e293b' }}>Requisição de Materiais</h1>
            <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>Qual setor está fazendo a requisição?</p>
          </div>
        </div>

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '4rem', color: '#64748b' }}>
            <Loader2 size={22} style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontWeight: 600 }}>Carregando setores...</span>
          </div>
        )}

        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '1rem 1.25rem', background: '#fef2f2', border: '1px solid rgba(244,63,94,0.3)', borderRadius: 12, color: '#ef4444', fontSize: 13, fontWeight: 600 }}>
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {!loading && !error && sectors.length === 0 && (
          <div style={{ textAlign: 'center', padding: '4rem', color: '#94a3b8' }}>
            <Package size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
            <p style={{ fontWeight: 600, margin: 0 }}>Nenhum setor disponível.</p>
            <p style={{ fontSize: 13, margin: '6px 0 0' }}>Contacte o administrador do sistema.</p>
          </div>
        )}

        {!loading && sectors.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sectors.map(sector => {
              const color = sector.color || '#6366f1';
              return (
                <Link
                  key={sector.id}
                  to={`/sector/${sector.id}`}
                  style={{ textDecoration: 'none' }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 16,
                    padding: '1rem 1.25rem',
                    background: '#fff',
                    border: '1px solid #e2e8f0',
                    borderRadius: 16,
                    cursor: 'pointer',
                    transition: 'box-shadow 0.15s, border-color 0.15s',
                  }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 12px -2px rgba(0,0,0,0.1)';
                      (e.currentTarget as HTMLDivElement).style.borderColor = color;
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
                      (e.currentTarget as HTMLDivElement).style.borderColor = '#e2e8f0';
                    }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Package size={20} color={color} />
                    </div>
                    <span style={{ flex: 1, fontWeight: 700, fontSize: 15, color: '#1e293b' }}>{sector.name}</span>
                    <ChevronRight size={18} color="#94a3b8" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        a:hover > div { border-color: inherit; }
      `}</style>
    </div>
  );
}
