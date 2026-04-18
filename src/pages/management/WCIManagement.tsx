// src/pages/management/WCIManagement.tsx
// Gerenciamento do Web Check-in por unidade:
//   - Ocultar/exibir hotel na seleção de check-in
//   - Editar Regulamento Interno por hotel (PT / EN / ES)
//   - Editar Política de Privacidade (LGPD) por hotel (PT / EN / ES)
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useHotel } from '../../context/HotelContext';
import { Loader2, Save, Eye, EyeOff, ChevronDown, ChevronUp, CheckCircle, AlertTriangle, FileText, Shield, RotateCcw, Type } from 'lucide-react';

type PolicyLang = 'pt' | 'en' | 'es';
type DocTab     = 'hotel' | 'lgpd';

/** Textarea que cresce automaticamente com o conteúdo */
function AutoTextarea({
  value, onChange, placeholder, minRows = 20,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  minRows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => { resize(); }, [value, resize]);

  const words = value.trim() ? value.trim().split(/\s+/).length : 0;
  const chars = value.length;

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        onChange={e => { onChange(e.target.value); resize(); }}
        placeholder={placeholder}
        style={{
          minHeight: `${minRows * 1.625}rem`,
          resize: 'none',
          overflowY: 'hidden',
          lineHeight: '1.75',
          letterSpacing: '0.01em',
          fontSize: '0.9rem',
          fontFamily: '"Inter", "Segoe UI", system-ui, sans-serif',
          transition: 'border-color 0.15s',
        }}
        className="w-full rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 p-5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />
      <div className="absolute bottom-3 right-4 flex gap-3 text-xs text-gray-400 dark:text-gray-500 pointer-events-none select-none">
        <span><Type size={11} className="inline mr-1" />{chars.toLocaleString()} chars</span>
        <span>{words.toLocaleString()} palavras</span>
      </div>
    </div>
  );
}

interface HotelPolicy {
  id: string;
  name: string;
  image_url: string | null;
  wci_visible: boolean;
  wci_hotel_terms:    string | null;
  wci_lgpd_terms:     string | null;
  wci_hotel_terms_en: string | null;
  wci_lgpd_terms_en:  string | null;
  wci_hotel_terms_es: string | null;
  wci_lgpd_terms_es:  string | null;
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
  const [policyLang, setPolicyLang] = useState<Record<string, PolicyLang>>({});
  const [docTab,     setDocTab]     = useState<Record<string, DocTab>>({});
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
      .select('id, name, image_url, wci_visible, wci_hotel_terms, wci_lgpd_terms, wci_hotel_terms_en, wci_lgpd_terms_en, wci_hotel_terms_es, wci_lgpd_terms_es')
      .order('name');
    if (error) { setError(error.message); setLoading(false); return; }
    setHotels((data || []).map((h: any) => ({
      ...h,
      wci_hotel_terms_en: h.wci_hotel_terms_en ?? null,
      wci_lgpd_terms_en:  h.wci_lgpd_terms_en  ?? null,
      wci_hotel_terms_es: h.wci_hotel_terms_es ?? null,
      wci_lgpd_terms_es:  h.wci_lgpd_terms_es  ?? null,
    })));
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
      .update({
        wci_hotel_terms:    hotel.wci_hotel_terms,
        wci_lgpd_terms:     hotel.wci_lgpd_terms,
        wci_hotel_terms_en: hotel.wci_hotel_terms_en,
        wci_lgpd_terms_en:  hotel.wci_lgpd_terms_en,
        wci_hotel_terms_es: hotel.wci_hotel_terms_es,
        wci_lgpd_terms_es:  hotel.wci_lgpd_terms_es,
      })
      .eq('id', hotel.id);
    setSaving(null);
    if (error) { setError(error.message); return; }
    setSaved(hotel.id);
    setTimeout(() => setSaved(null), 2500);
  };

  /** Devolve os campos corretos baseado no idioma selecionado */
  const getLangFields = (hotel: HotelPolicy, lang: PolicyLang) => {
    if (lang === 'en') return { hotel_terms: hotel.wci_hotel_terms_en, lgpd_terms: hotel.wci_lgpd_terms_en };
    if (lang === 'es') return { hotel_terms: hotel.wci_hotel_terms_es, lgpd_terms: hotel.wci_lgpd_terms_es };
    return { hotel_terms: hotel.wci_hotel_terms, lgpd_terms: hotel.wci_lgpd_terms };
  };

  const setLangField = (hotelId: string, lang: PolicyLang, field: 'hotel_terms' | 'lgpd_terms', value: string) => {
    setHotels(prev => prev.map(h => {
      if (h.id !== hotelId) return h;
      if (lang === 'en') return { ...h, [field === 'hotel_terms' ? 'wci_hotel_terms_en' : 'wci_lgpd_terms_en']: value };
      if (lang === 'es') return { ...h, [field === 'hotel_terms' ? 'wci_hotel_terms_es' : 'wci_lgpd_terms_es']: value };
      return { ...h, [field === 'hotel_terms' ? 'wci_hotel_terms' : 'wci_lgpd_terms']: value };
    }));
  };

  const getDefaultForLang = (type: 'hotel' | 'lgpd', lang: PolicyLang) => {
    if (lang !== 'pt') return ''; // sem texto padrão para EN/ES — o admin deve preencher
    return type === 'hotel' ? DEFAULT_HOTEL_TERMS : DEFAULT_LGPD_TERMS;
  };


  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="animate-spin text-blue-500 w-10 h-10" />
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">

      {/* Cabeçalho */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Web Check-in — Gestão por Unidade</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">
          Configure a visibilidade e edite o Regulamento Interno e a Política LGPD de cada hotel em 3 idiomas.
        </p>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3 text-red-700 dark:text-red-400 text-sm">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      <div className="space-y-5">
        {hotels.map(hotel => {
          const isOpen      = expanded  === hotel.id;
          const activeLang  = policyLang[hotel.id] ?? 'pt' as PolicyLang;
          const activeDoc   = docTab[hotel.id]    ?? 'hotel' as DocTab;
          const fields      = getLangFields(hotel, activeLang);

          const LANG_META: Record<PolicyLang, { flag: string; label: string }> = {
            pt: { flag: '🇧🇷', label: 'Português' },
            en: { flag: '🇬🇧', label: 'English'   },
            es: { flag: '🇪🇸', label: 'Español'   },
          };

          const currentValue = activeDoc === 'hotel'
            ? (fields.hotel_terms ?? getDefaultForLang('hotel', activeLang))
            : (fields.lgpd_terms  ?? getDefaultForLang('lgpd',  activeLang));

          const setCurrentValue = (v: string) =>
            setLangField(hotel.id, activeLang, activeDoc === 'hotel' ? 'hotel_terms' : 'lgpd_terms', v);

          const isDefault = activeLang === 'pt';
          const defaultText = activeDoc === 'hotel' ? DEFAULT_HOTEL_TERMS : DEFAULT_LGPD_TERMS;

          return (
            <div key={hotel.id} className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden transition-all">

              {/* ── Card header ─────────────────────────────────────────── */}
              <div className="flex items-center gap-4 p-5">
                <div className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 bg-gray-100 dark:bg-gray-700 shadow-sm">
                  {hotel.image_url
                    ? <img src={hotel.image_url} alt={hotel.name} className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center text-gray-400 font-bold text-base">
                        {hotel.name.slice(0, 2).toUpperCase()}
                      </div>
                  }
                </div>

                <div className="flex-1 min-w-0">
                  <h2 className="font-bold text-gray-900 dark:text-white text-base truncate">{hotel.name}</h2>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${
                      hotel.wci_visible
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                    }`}>
                      {hotel.wci_visible ? '● Visível no check-in' : '○ Oculto no check-in'}
                    </span>
                    {isOpen && (
                      <span className="text-xs text-blue-500 dark:text-blue-400 font-medium">
                        Editando políticas
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => toggleVisible(hotel)}
                    title={hotel.wci_visible ? 'Ocultar do check-in' : 'Exibir no check-in'}
                    className={`p-2.5 rounded-xl transition-colors text-sm font-medium flex items-center gap-1.5 ${
                      hotel.wci_visible
                        ? 'text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20'
                        : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    {hotel.wci_visible ? <Eye size={18} /> : <EyeOff size={18} />}
                  </button>

                  <button
                    onClick={() => setExpanded(isOpen ? null : hotel.id)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-colors ${
                      isOpen
                        ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400'
                        : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    {isOpen ? <><ChevronUp size={16} /> Fechar</> : <><ChevronDown size={16} /> Editar Políticas</>}
                  </button>
                </div>
              </div>

              {/* ── Editor expandido ─────────────────────────────────────── */}
              {isOpen && (
                <div className="border-t border-gray-100 dark:border-gray-700">

                  {/* Barra de controles */}
                  <div className="flex flex-wrap items-center gap-3 px-5 py-3 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-100 dark:border-gray-700">

                    {/* Tabs de documento */}
                    <div className="flex gap-1 bg-gray-200 dark:bg-gray-700 rounded-lg p-1">
                      {([
                        { key: 'hotel', icon: <FileText size={14} />, label: 'Regulamento' },
                        { key: 'lgpd',  icon: <Shield   size={14} />, label: 'LGPD'        },
                      ] as const).map(tab => (
                        <button
                          key={tab.key}
                          onClick={() => setDocTab(prev => ({ ...prev, [hotel.id]: tab.key }))}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                            activeDoc === tab.key
                              ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm'
                              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                          }`}
                        >
                          {tab.icon} {tab.label}
                        </button>
                      ))}
                    </div>

                    {/* Divisor */}
                    <div className="w-px h-5 bg-gray-300 dark:bg-gray-600" />

                    {/* Tabs de idioma */}
                    <div className="flex gap-1">
                      {(['pt', 'en', 'es'] as PolicyLang[]).map(l => {
                        const m = LANG_META[l];
                        return (
                          <button
                            key={l}
                            onClick={() => setPolicyLang(prev => ({ ...prev, [hotel.id]: l }))}
                            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                              activeLang === l
                                ? 'bg-blue-600 text-white shadow-sm'
                                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                            }`}
                          >
                            <span>{m.flag}</span> {m.label}
                          </button>
                        );
                      })}
                    </div>

                    {/* Aviso fallback EN/ES */}
                    {activeLang !== 'pt' && (
                      <span className="ml-auto text-xs text-amber-600 dark:text-amber-400 font-medium">
                        ⚠ Vazio → usa PT como fallback
                      </span>
                    )}

                    {/* Restaurar padrão */}
                    {isDefault && (
                      <button
                        onClick={() => setCurrentValue(defaultText)}
                        className="ml-auto flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                        title="Restaurar texto padrão"
                      >
                        <RotateCcw size={12} /> Restaurar padrão
                      </button>
                    )}
                  </div>

                  {/* Área do editor */}
                  <div className="p-5">

                    {/* Título do documento ativo */}
                    <div className="flex items-center gap-2 mb-3">
                      <div className={`p-1.5 rounded-lg ${activeDoc === 'hotel' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'}`}>
                        {activeDoc === 'hotel' ? <FileText size={15} /> : <Shield size={15} />}
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                          {activeDoc === 'hotel' ? 'Regulamento Interno do Hotel' : 'Política de Privacidade (LGPD)'}
                          <span className="ml-2 text-xs font-normal text-gray-400 dark:text-gray-500">
                            — {LANG_META[activeLang].flag} {LANG_META[activeLang].label}
                          </span>
                        </h3>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                          {activeDoc === 'hotel'
                            ? 'Exibido ao hóspede antes da assinatura digital. Gerado como JPEG e enviado à Erbon.'
                            : 'Exibido ao hóspede junto à coleta de dados. Gerado como JPEG e enviado à Erbon.'
                          }
                        </p>
                      </div>
                    </div>

                    <AutoTextarea
                      key={`${hotel.id}-${activeDoc}-${activeLang}`}
                      value={currentValue}
                      onChange={setCurrentValue}
                      placeholder={
                        activeLang === 'pt'
                          ? (activeDoc === 'hotel' ? DEFAULT_HOTEL_TERMS : DEFAULT_LGPD_TERMS)
                          : `Digite aqui a versão em ${LANG_META[activeLang].label}…`
                      }
                      minRows={22}
                    />
                  </div>

                  {/* Footer — botão salvar */}
                  <div className="flex items-center justify-between px-5 py-3 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-100 dark:border-gray-700">
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      O salvar grava <strong>todos os idiomas</strong> de uma vez.
                    </p>
                    <button
                      onClick={() => savePolicy(hotel)}
                      disabled={saving === hotel.id}
                      className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-sm ${
                        saved === hotel.id
                          ? 'bg-green-500 text-white'
                          : 'bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white'
                      }`}
                    >
                      {saving === hotel.id
                        ? <><Loader2 size={15} className="animate-spin" /> Salvando…</>
                        : saved === hotel.id
                          ? <><CheckCircle size={15} /> Salvo com sucesso!</>
                          : <><Save size={15} /> Salvar todas as políticas</>
                      }
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
