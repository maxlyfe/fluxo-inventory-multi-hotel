// src/components/BarcodeScanner.tsx
// Scanner de código de barras via câmera do dispositivo
// Dependência: npm install @zxing/browser @zxing/library

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { NotFoundException } from '@zxing/library';
import { X, Camera, CameraOff, Loader2, RefreshCw } from 'lucide-react';

interface BarcodeScannerProps {
  onDetected: (barcode: string) => void;
  onClose: () => void;
  title?: string;
  hint?: string;
}

const BarcodeScanner: React.FC<BarcodeScannerProps> = ({
  onDetected,
  onClose,
  title = 'Escanear Código de Barras',
  hint = 'Aponte a câmera para o código de barras',
}) => {
  const videoRef      = useRef<HTMLVideoElement>(null);
  const readerRef     = useRef<BrowserMultiFormatReader | null>(null);
  const controlsRef   = useRef<{ stop: () => void } | null>(null);

  const [error,      setError]      = useState<string | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [cameras,    setCameras]    = useState<MediaDeviceInfo[]>([]);
  const [cameraIdx,  setCameraIdx]  = useState(0);
  const [lastScan,   setLastScan]   = useState<string | null>(null);
  const [flash,      setFlash]      = useState(false);

  // Inicializa leitor
  const startReader = useCallback(async (deviceIndex: number) => {
    try {
      setLoading(true);
      setError(null);

      // Para leitura anterior se existir
      if (controlsRef.current) {
        controlsRef.current.stop();
        controlsRef.current = null;
      }
      if (readerRef.current) {
        readerRef.current = null;
      }

      // Lista câmeras disponíveis
      const devices = await BrowserMultiFormatReader.listVideoInputDevices();
      setCameras(devices);

      if (!devices.length) {
        setError('Nenhuma câmera encontrada neste dispositivo.');
        setLoading(false);
        return;
      }

      // Prefere câmera traseira (environment)
      let targetIdx = deviceIndex;
      if (deviceIndex === 0) {
        const backIdx = devices.findIndex(d =>
          d.label.toLowerCase().includes('back') ||
          d.label.toLowerCase().includes('rear') ||
          d.label.toLowerCase().includes('environment')
        );
        if (backIdx >= 0) targetIdx = backIdx;
      }

      const deviceId = devices[targetIdx % devices.length]?.deviceId;

      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;

      const controls = await reader.decodeFromVideoDevice(
        deviceId,
        videoRef.current!,
        (result, err) => {
          if (result) {
            const code = result.getText();
            setLastScan(code);
            // Flash visual
            setFlash(true);
            setTimeout(() => setFlash(false), 400);
            onDetected(code);
          }
          if (err && !(err instanceof NotFoundException)) {
            console.warn('Scanner error:', err);
          }
        }
      );

      controlsRef.current = controls;
      setLoading(false);
    } catch (err: any) {
      console.error('Erro ao acessar câmera:', err);
      if (err.name === 'NotAllowedError') {
        setError('Permissão de câmera negada. Permita o acesso nas configurações do navegador.');
      } else if (err.name === 'NotFoundError') {
        setError('Câmera não encontrada. Verifique se o dispositivo tem câmera.');
      } else {
        setError('Não foi possível acessar a câmera: ' + (err.message || err.name));
      }
      setLoading(false);
    }
  }, [onDetected]);

  useEffect(() => {
    startReader(0);
    return () => {
      // Cleanup ao desmontar
      if (controlsRef.current) controlsRef.current.stop();
      if (readerRef.current) readerRef.current = null;
    };
  }, []);

  const handleSwitchCamera = () => {
    const next = (cameraIdx + 1) % cameras.length;
    setCameraIdx(next);
    startReader(next);
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/80 backdrop-blur-sm z-10">
        <div>
          <h2 className="text-white font-bold text-base">{title}</h2>
          <p className="text-white/50 text-xs">{hint}</p>
        </div>
        <button
          onClick={onClose}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Viewfinder */}
      <div className="relative flex-1 overflow-hidden">
        {/* Vídeo da câmera */}
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          playsInline
          muted
          autoPlay
        />

        {/* Flash de detecção */}
        {flash && (
          <div className="absolute inset-0 bg-white/30 z-10 pointer-events-none transition-opacity" />
        )}

        {/* Loading overlay */}
        {loading && (
          <div className="absolute inset-0 bg-black flex flex-col items-center justify-center gap-3 z-20">
            <Loader2 className="w-10 h-10 text-white animate-spin" />
            <p className="text-white/70 text-sm">Iniciando câmera...</p>
          </div>
        )}

        {/* Error overlay */}
        {error && (
          <div className="absolute inset-0 bg-black flex flex-col items-center justify-center gap-4 z-20 px-8">
            <CameraOff className="w-12 h-12 text-red-400" />
            <p className="text-white/80 text-sm text-center">{error}</p>
            <button
              onClick={() => startReader(cameraIdx)}
              className="flex items-center gap-2 px-4 py-2 bg-white/10 rounded-xl text-white text-sm"
            >
              <RefreshCw className="w-4 h-4" /> Tentar novamente
            </button>
          </div>
        )}

        {/* Mira de foco */}
        {!loading && !error && (
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <div className="relative w-64 h-40">
              {/* Cantos do viewfinder */}
              {[
                'top-0 left-0 border-t-4 border-l-4 rounded-tl-lg',
                'top-0 right-0 border-t-4 border-r-4 rounded-tr-lg',
                'bottom-0 left-0 border-b-4 border-l-4 rounded-bl-lg',
                'bottom-0 right-0 border-b-4 border-r-4 rounded-br-lg',
              ].map((cls, i) => (
                <div key={i} className={`absolute w-8 h-8 border-white ${cls}`} />
              ))}
              {/* Linha de scan animada */}
              <div className="absolute left-1 right-1 h-0.5 bg-green-400/80 animate-scan-line" />
            </div>
          </div>
        )}

        {/* Overlay escurecido nas bordas */}
        {!loading && !error && (
          <>
            <div className="absolute inset-0 pointer-events-none z-[5]"
              style={{
                background: `
                  linear-gradient(to right, rgba(0,0,0,0.55) 0%, transparent 28%, transparent 72%, rgba(0,0,0,0.55) 100%),
                  linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, transparent 28%, transparent 72%, rgba(0,0,0,0.55) 100%)
                `,
              }}
            />
          </>
        )}
      </div>

      {/* Footer */}
      <div className="bg-black/80 backdrop-blur-sm px-4 py-4 z-10">
        {/* Último scan */}
        {lastScan && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-xl bg-green-500/20 border border-green-500/30">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <p className="text-green-300 text-xs font-mono flex-1 truncate">
              Detectado: <span className="font-bold">{lastScan}</span>
            </p>
          </div>
        )}

        <div className="flex items-center gap-3">
          {/* Trocar câmera */}
          {cameras.length > 1 && (
            <button
              onClick={handleSwitchCamera}
              className="flex items-center gap-2 px-4 py-3 rounded-xl bg-white/10 text-white text-sm hover:bg-white/20 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Trocar câmera</span>
            </button>
          )}

          <button
            onClick={onClose}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-white/10 text-white font-semibold hover:bg-white/20 transition-colors"
          >
            <Camera className="w-5 h-5" />
            Fechar Scanner
          </button>
        </div>
      </div>

      {/* CSS animation inline */}
      <style>{`
        @keyframes scan-line {
          0%   { top: 8px;  opacity: 1; }
          50%  { top: calc(100% - 8px); opacity: 1; }
          100% { top: 8px;  opacity: 1; }
        }
        .animate-scan-line {
          animation: scan-line 2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
};

export default BarcodeScanner;