// src/pages/management/WCIManagement.tsx
// Gerenciamento do Web Check-in por unidade:
//   - Ocultar/exibir hotel na seleção de check-in
//   - Editar Regulamento Interno por hotel
//   - Editar Política de Privacidade (LGPD) por hotel
import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useHotel } from '../../context/HotelContext';
import { Loader2, Save, Eye, EyeOff, ChevronDown, ChevronUp, CheckCircle, AlertTriangle } from 'lucide-react';

interface HotelPolicy {
  id: string;
  name: string;
  image_url: string | null;
  wci_visible: boolean;
  wci_hotel_terms: string | null;
  wci_lgpd_terms: string | null;
}

const DEFAULT_HOTEL_TERMS = `REGULAMENTO INTERNO E POLÍTICAS DO HOTEL

1. CHECK-IN E CHECK-OUT
O horário de check-in é a partir das 14h00 e o check-out até as 12h00. Check-in antecipado ou late check-out estão sujeitos à disponibilidade e podem gerar cobrança adicional.

2. RESPONSABILIDADE POR DANOS
O hóspede é responsável por quaisquer danos causados às instalações, móveis, equipamentos e utensílios do hotel durante o período de hospedagem. Os danos serão avaliados e cobrados no ato do check-out.

3. SILÊNCIO E CONVIVÊNCIA
O horário de silêncio é entre 22h00 e 08h00. São proibidos barulhos excessivos, festas ou reuniões que perturbem os demais hóspedes.

4. TABAGISMO
É estritamente proibido fumar nas áreas internas do hotel, incluindo quartos, corredores e áreas comuns cobertas.

5. ANIMAIS DE ESTIMAÇÃO
A entrada de animais de estimação é permitida somente nas acomodações indicadas como pet-friendly, mediante declaração prévia e taxa adicional.

6. SEGURANÇA
Não é permitida a entrada de pessoas não hospedadas nas acomodações sem autorização prévia da recepção.

7. ESTACIONAMENTO
O hotel não se responsabiliza por danos, furtos ou roubos de veículos e/ou objetos deixados no estacionamento.

8. CANCELAMENTO E REEMBOLSO
As políticas de cancelamento e reembolso são informadas no momento da reserva e fazem parte integrante do contrato de hospedagem.`;

const DEFAULT_LGPD_TERMS = `POLÍTICA DE PRIVACIDADE E PROTEÇÃO DE DADOS (LGPD)

Em conformidade com a Lei Geral de Proteção de Dados Pessoais — LGPD (Lei nº 13.709/2018), informamos:

DADOS COLETADOS
Nome completo, data de nascimento, gênero, documento de identidade, e-mail, telefone, endereço, veículo e demais informações fornecidas neste formulário de registro de hóspede (FNRH).

FINALIDADE DO TRATAMENTO
Os dados são coletados exclusivamente para: (a) cumprimento de obrigação legal de registro de hóspedes exigida pela Portaria MTur 217/2020; (b) prestação dos serviços de hospedagem; (c) comunicações relacionadas à estadia.

BASE LEGAL
Obrigação legal (Art. 7º, II), execução de contrato (Art. 7º, V) e legítimo interesse do controlador (Art. 7º, IX) da Lei nº 13.709/2018.

DIREITOS DO TITULAR
O hóspede tem direito a: confirmar a existência de tratamento; acessar, corrigir ou solicitar a exclusão de seus dados; revogar o consentimento. Para exercer esses direitos, dirija-se à recepção do hotel.

VALIDADE DA ASSINATURA DIGITAL
A assinatura digital aposta neste documento tem validade jurídica plena nos termos do Marco Civil da Internet (Lei nº 12.965/2014) e da MP 2.200-2/2001.`;

export default function WCIManagement() {
  const { selectedHotel } = useHotel();
  const [hotels, setHotels] = useState<HotelPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchHotels();
  }, []);

  const fetchHotels = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('hotels')
      .select('id, name, image_url, wci_visible, wci_hotel_terms, wci_lgpd_terms')
      .order('name');
    if (error) { setError(error.message); setLoading(false); return; }
    setHotels(data || []);
    setLoading(false);
  };

  const toggleVisible = async (hotel: HotelPolicy) => {
    const newVal = !hotel.wci_visible;
    setHotels(prev => prev.map(h => h.id === hotel.id ? { ...h, wci_visible: newVal } : h));
    await supabase.from('hotels').update({ wci_visible: newVal }).eq('id', hotel.id);
  };

  const savePolicy = async (hotel: HotelPolicy) => {
    setSaving(hotel.id);
    const { error } = await supabase
      .from('hotels')
      .update({ wci_hotel_terms: hotel.wci_hotel_terms, wci_lgpd_terms: hotel.wci_lgpd_terms })
      .eq('id', hotel.id);
    setSaving(null);
    if (error) { setError(error.message); return; }
    setSaved(hotel.id);
    setTimeout(() => setSaved(null), 2500);
  };

  const updateField = (id: string, field: keyof HotelPolicy, value: any) => {
    setHotels(prev => prev.map(h => h.id === id ? { ...h, [field]: value } : h));
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="animate-spin text-blue-500 w-10 h-10" />
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Web Check-in — Gestão por Unidade</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">
          Configure a visibilidade, o Regulamento Interno e a Política LGPD de cada hotel exibido no check-in online.
        </p>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-red-700 dark:text-red-400 text-sm">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      <div className="space-y-4">
        {hotels.map(hotel => (
          <div key={hotel.id} className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 overflow-hidden">

            {/* Header do card */}
            <div className="flex items-center gap-4 p-4">
              {/* Thumb */}
              <div className="w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 bg-gray-100 dark:bg-gray-700">
                {hotel.image_url
                  ? <img src={hotel.image_url} alt={hotel.name} className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs font-bold">{hotel.name.slice(0,2).toUpperCase()}</div>
                }
              </div>

              <div className="flex-1 min-w-0">
                <h2 className="font-semibold text-gray-900 dark:text-white truncate">{hotel.name}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${hotel.wci_visible ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}>
                    {hotel.wci_visible ? 'Visível no check-in' : 'Oculto no check-in'}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Toggle visibilidade */}
                <button
                  onClick={() => toggleVisible(hotel)}
                  title={hotel.wci_visible ? 'Ocultar do check-in' : 'Exibir no check-in'}
                  className={`p-2 rounded-lg transition-colors ${hotel.wci_visible ? 'text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                >
                  {hotel.wci_visible ? <Eye size={18} /> : <EyeOff size={18} />}
                </button>

                {/* Expandir políticas */}
                <button
                  onClick={() => setExpanded(expanded === hotel.id ? null : hotel.id)}
                  className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  {expanded === hotel.id ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>
              </div>
            </div>

            {/* Editors — expandido */}
            {expanded === hotel.id && (
              <div className="border-t border-gray-200 dark:border-gray-700 p-4 space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Regulamento Interno do Hotel
                    </label>
                    <button
                      className="text-xs text-blue-500 hover:underline"
                      onClick={() => updateField(hotel.id, 'wci_hotel_terms', DEFAULT_HOTEL_TERMS)}
                    >
                      Restaurar padrão
                    </button>
                  </div>
                  <textarea
                    className="w-full h-48 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 text-sm p-3 font-mono resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={hotel.wci_hotel_terms ?? DEFAULT_HOTEL_TERMS}
                    onChange={e => updateField(hotel.id, 'wci_hotel_terms', e.target.value)}
                    placeholder={DEFAULT_HOTEL_TERMS}
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Política de Privacidade (LGPD)
                    </label>
                    <button
                      className="text-xs text-blue-500 hover:underline"
                      onClick={() => updateField(hotel.id, 'wci_lgpd_terms', DEFAULT_LGPD_TERMS)}
                    >
                      Restaurar padrão
                    </button>
                  </div>
                  <textarea
                    className="w-full h-48 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 text-sm p-3 font-mono resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={hotel.wci_lgpd_terms ?? DEFAULT_LGPD_TERMS}
                    onChange={e => updateField(hotel.id, 'wci_lgpd_terms', e.target.value)}
                    placeholder={DEFAULT_LGPD_TERMS}
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={() => savePolicy(hotel)}
                    disabled={saving === hotel.id}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    {saving === hotel.id
                      ? <><Loader2 size={15} className="animate-spin" /> Salvando...</>
                      : saved === hotel.id
                        ? <><CheckCircle size={15} /> Salvo!</>
                        : <><Save size={15} /> Salvar Políticas</>
                    }
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
