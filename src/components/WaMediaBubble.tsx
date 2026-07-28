// src/components/WaMediaBubble.tsx
// Exibe a mídia de uma mensagem do WhatsApp no inbox.
//
// A mídia no WhatsApp é criptografada: a url que chega no webhook não abre no
// navegador. Quem descriptografa é o Evolution, a partir do WebMessageInfo que o
// webhook guardou em content.raw.
//
// O download é sob demanda, ao entrar em tela, porque uma conversa longa com
// muitas imagens faria dezenas de chamadas ao servidor de uma vez, e no celular
// isso derruba o socket do WhatsApp.

import React, { useEffect, useRef, useState } from 'react';
import { Loader2, AlertCircle, Download, FileText, Play } from 'lucide-react';
import { whatsappService } from '../lib/whatsappService';

/**
 * Cache de sessão dos data URIs já baixados, por id de mensagem.
 *
 * Fica fora do componente de propósito: rolar a conversa desmonta e remonta as
 * bolhas, e sem isso a mesma imagem seria baixada de novo a cada passagem.
 */
const cache = new Map<string, string>();

interface Props {
  messageId: string;
  hotelId: string;
  type: 'image' | 'audio' | 'video' | 'document' | 'sticker';
  content: Record<string, unknown>;
  isOut: boolean;
}

const WaMediaBubble: React.FC<Props> = ({ messageId, hotelId, type, content, isOut }) => {
  const [dataUri, setDataUri] = useState<string | null>(cache.get(messageId) || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visivel, setVisivel] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const caption = content?.caption as string | undefined;
  const filename = content?.filename as string | undefined;
  const mime = content?.mime_type as string | undefined;
  const raw = content?.raw;

  // Só baixa quando a bolha entra em tela
  useEffect(() => {
    if (dataUri || !ref.current) return;
    const obs = new IntersectionObserver(
      entries => { if (entries.some(e => e.isIntersecting)) setVisivel(true); },
      { rootMargin: '200px' },
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [dataUri]);

  useEffect(() => {
    if (!visivel || dataUri || loading || error) return;
    let ativo = true;

    (async () => {
      setLoading(true);
      try {
        const res = await whatsappService.getMessageMedia({ hotelId, rawMessage: raw, fallbackMime: mime });
        if (!ativo) return;
        if (res.success && res.dataUri) {
          cache.set(messageId, res.dataUri);
          setDataUri(res.dataUri);
        } else {
          setError(res.error || 'Não foi possível carregar a mídia.');
        }
      } catch (err: unknown) {
        if (ativo) setError(err instanceof Error ? err.message : 'Erro ao carregar a mídia.');
      } finally {
        if (ativo) setLoading(false);
      }
    })();

    return () => { ativo = false; };
  }, [visivel, dataUri, loading, error, hotelId, raw, mime, messageId]);

  const legenda = caption ? (
    <p className="text-sm mt-1 whitespace-pre-wrap">{caption}</p>
  ) : null;

  // ── Estados de carregamento e falha ────────────────────────────────────────
  if (!dataUri) {
    const rotulo = type === 'image' ? 'Imagem'
      : type === 'video' ? 'Vídeo'
      : type === 'audio' ? 'Áudio'
      : type === 'sticker' ? 'Figurinha'
      : (filename || 'Documento');

    return (
      <div ref={ref}>
        <div className={`flex items-center gap-2 px-3 py-2.5 rounded-lg ${
          isOut ? 'bg-black/10' : 'bg-gray-100 dark:bg-gray-700/50'
        }`}>
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin shrink-0 opacity-70" />
          ) : error ? (
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-500" />
          ) : (
            <FileText className="w-4 h-4 shrink-0 opacity-50" />
          )}
          <div className="min-w-0">
            <p className="text-sm truncate">{rotulo}</p>
            {error && (
              <p className={`text-[10px] mt-0.5 ${isOut ? 'text-white/70' : 'text-gray-400'}`}>{error}</p>
            )}
          </div>
          {error && (
            <button
              onClick={() => { setError(null); setVisivel(true); }}
              className="ml-auto text-[10px] font-bold underline opacity-80 hover:opacity-100 shrink-0"
            >
              Tentar de novo
            </button>
          )}
        </div>
        {legenda}
      </div>
    );
  }

  // ── Mídia carregada ────────────────────────────────────────────────────────
  if (type === 'image' || type === 'sticker') {
    return (
      <div ref={ref}>
        <a href={dataUri} target="_blank" rel="noopener noreferrer">
          <img
            src={dataUri}
            alt={caption || 'Imagem recebida'}
            className={`rounded-lg max-w-full object-contain ${type === 'sticker' ? 'w-32' : 'max-h-72'}`}
            loading="lazy"
          />
        </a>
        {legenda}
      </div>
    );
  }

  if (type === 'video') {
    return (
      <div ref={ref}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- vídeo de terceiro, sem legenda disponível */}
        <video src={dataUri} controls preload="metadata" className="rounded-lg max-w-full max-h-72">
          <Play className="w-4 h-4" />
        </video>
        {legenda}
      </div>
    );
  }

  if (type === 'audio') {
    return (
      <div ref={ref}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- áudio de terceiro, sem legenda disponível */}
        <audio src={dataUri} controls preload="metadata" className="max-w-[240px]" />
        {legenda}
      </div>
    );
  }

  // Documento: link de download, com o nome original
  return (
    <div ref={ref}>
      <a
        href={dataUri}
        download={filename || 'documento'}
        className={`flex items-center gap-2 px-3 py-2.5 rounded-lg transition-colors ${
          isOut ? 'bg-black/10 hover:bg-black/20' : 'bg-gray-100 dark:bg-gray-700/50 hover:bg-gray-200 dark:hover:bg-gray-700'
        }`}
      >
        <FileText className="w-4 h-4 shrink-0 opacity-70" />
        <span className="text-sm truncate flex-1">{filename || 'Documento'}</span>
        <Download className="w-3.5 h-3.5 shrink-0 opacity-70" />
      </a>
      {legenda}
    </div>
  );
};

export default WaMediaBubble;
