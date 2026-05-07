import React from 'react';
import {
  User, LogIn, LogOut, Wrench, Sparkles, Clock, CheckCircle, Loader2
} from 'lucide-react';
import { ErbonRoom } from '../../lib/erbonService';
import { RoomWorkflowStatus } from '../../lib/governanceService';

// ─── SVG DOOR ILLUSTRATIONS ──────────────────────────────────────────────────

const DoorOpen: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 64 80" fill="none" className={className}>
    <rect x="8" y="4" width="48" height="72" rx="3" stroke="currentColor" strokeWidth="2" opacity="0.3" />
    <path d="M8 4 L28 12 L28 68 L8 76 Z" fill="currentColor" opacity="0.08" stroke="currentColor" strokeWidth="1.5" />
    <rect x="28" y="12" width="24" height="56" fill="currentColor" opacity="0.04" />
    <circle cx="24" cy="42" r="2" fill="currentColor" opacity="0.5" />
  </svg>
);

const DoorClosed: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 64 80" fill="none" className={className}>
    <rect x="8" y="4" width="48" height="72" rx="3" stroke="currentColor" strokeWidth="2" opacity="0.3" />
    <rect x="10" y="6" width="44" height="68" rx="2" fill="currentColor" opacity="0.12" />
    <circle cx="44" cy="42" r="2.5" fill="currentColor" opacity="0.4" />
    <rect x="42" y="44" width="4" height="6" rx="1" fill="currentColor" opacity="0.25" />
  </svg>
);

const DoorBlocked: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 64 80" fill="none" className={className}>
    <rect x="8" y="4" width="48" height="72" rx="3" stroke="currentColor" strokeWidth="2" opacity="0.3" />
    <line x1="18" y1="20" x2="46" y2="56" stroke="currentColor" strokeWidth="2.5" opacity="0.35" strokeLinecap="round" />
    <line x1="46" y1="20" x2="18" y2="56" stroke="currentColor" strokeWidth="2.5" opacity="0.35" strokeLinecap="round" />
    <rect x="4" y="34" width="56" height="8" rx="1" fill="currentColor" opacity="0.15" />
  </svg>
);

const DoorDND: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 64 80" fill="none" className={className}>
    <rect x="8" y="4" width="48" height="72" rx="3" stroke="currentColor" strokeWidth="2" opacity="0.3" />
    <rect x="10" y="6" width="44" height="68" rx="2" fill="currentColor" opacity="0.12" />
    <ellipse cx="32" cy="6" rx="12" ry="3" fill="currentColor" opacity="0.25" />
    <circle cx="44" cy="42" r="2.5" fill="currentColor" opacity="0.35" />
  </svg>
);

// ─── Component ────────────────────────────────────────────────────────────────

interface RoomRackCardProps {
  roomName: string;
  categoryName?: string | null;
  floor?: number | null;
  workflowStatus?: RoomWorkflowStatus;
  erbonStatus?: 'CLEAN' | 'DIRTY';
  occupied?: boolean;
  inMaintenance?: boolean;
  hasCheckinToday?: boolean;
  hasCheckoutToday?: boolean;
  bookingHolder?: string | null;
  adultCount?: number;
  childCount?: number;
  onSelect: () => void;
  actions?: React.ReactNode;
}

const STATUS_WF_META: Record<string, { label: string; color: string; bg: string }> = {
  pending_maint: { label: 'Vistoria Mant.', color: 'text-slate-400', bg: 'bg-slate-500/10' },
  maint_ok:      { label: 'Pronto Limpeza', color: 'text-blue-400',  bg: 'bg-blue-500/10'  },
  cleaning:      { label: 'Em Limpeza',     color: 'text-amber-400', bg: 'bg-amber-500/10' },
  clean:         { label: 'Limpo/Lib',      color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  contested:     { label: 'Contestado',      color: 'text-rose-400',  bg: 'bg-rose-500/10'  },
};

export const RoomRackCard: React.FC<RoomRackCardProps> = ({
  roomName, categoryName, floor, workflowStatus, erbonStatus,
  occupied, inMaintenance, hasCheckinToday, hasCheckoutToday,
  bookingHolder, adultCount, childCount, onSelect, actions
}) => {
  const isClean = erbonStatus === 'CLEAN';

  // Visual logic
  let DoorIcon = DoorOpen;
  let doorColor = 'text-emerald-500';
  let cardBg = 'from-emerald-950/40 to-gray-900';
  let borderColor = 'border-emerald-500/25 hover:border-emerald-400/50';
  let numberColor = 'text-emerald-400';
  let statusLabel = 'Disponível';
  let statusDot = 'bg-emerald-400';

  if (inMaintenance) {
    DoorIcon = DoorBlocked;
    doorColor = 'text-rose-500';
    cardBg = 'from-rose-950/40 to-gray-900';
    borderColor = 'border-rose-500/30 hover:border-rose-400/50';
    numberColor = 'text-rose-400';
    statusLabel = 'Manutenção';
    statusDot = 'bg-rose-400';
  } else if (occupied && !isClean) {
    DoorIcon = DoorDND;
    doorColor = 'text-amber-500';
    cardBg = 'from-amber-950/30 to-gray-900';
    borderColor = 'border-amber-500/25 hover:border-amber-400/50';
    numberColor = 'text-amber-400';
    statusLabel = 'Ocupado · Sujo';
    statusDot = 'bg-amber-400';
  } else if (occupied) {
    DoorIcon = DoorClosed;
    doorColor = 'text-sky-500';
    cardBg = 'from-sky-950/40 to-gray-900';
    borderColor = 'border-sky-500/25 hover:border-sky-400/50';
    numberColor = 'text-sky-400';
    statusLabel = 'Ocupado';
    statusDot = 'bg-sky-400';
  } else if (!isClean) {
    DoorIcon = DoorOpen;
    doorColor = 'text-amber-500';
    cardBg = 'from-amber-950/30 to-gray-900';
    borderColor = 'border-amber-500/25 hover:border-amber-400/50';
    numberColor = 'text-amber-400';
    statusLabel = 'Livre · Sujo';
    statusDot = 'bg-amber-400';
  }

  const wf = workflowStatus && STATUS_WF_META[workflowStatus];

  return (
    <div
      onClick={onSelect}
      className={`group relative border rounded-2xl overflow-hidden cursor-pointer
        transition-all duration-300 hover:scale-[1.04] hover:shadow-xl
        bg-gradient-to-b ${cardBg} ${borderColor}`}
    >
      {/* ── Door illustration ── */}
      <div className="relative flex items-center justify-center pt-3 pb-1">
        <DoorIcon className={`w-12 h-14 ${doorColor} transition-transform duration-300 group-hover:scale-110`} />

        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`text-xl font-black ${numberColor} drop-shadow-lg`}>{roomName}</span>
        </div>

        <div className="absolute top-1.5 right-1.5 flex flex-col gap-0.5">
          {hasCheckinToday && (
            <span className="w-5 h-5 rounded-full bg-violet-500/30 flex items-center justify-center" title="Check-in hoje">
              <LogIn className="w-2.5 h-2.5 text-violet-400" />
            </span>
          )}
          {hasCheckoutToday && (
            <span className="w-5 h-5 rounded-full bg-rose-500/30 flex items-center justify-center" title="Check-out hoje">
              <LogOut className="w-2.5 h-2.5 text-rose-400" />
            </span>
          )}
        </div>

        {wf && workflowStatus !== 'clean' && (
          <div className={`absolute bottom-0 left-0 right-0 py-0.5 text-[8px] font-black uppercase text-center backdrop-blur-md ${wf.bg} ${wf.color} border-t border-white/5`}>
            {wf.label}
          </div>
        )}

        {floor && floor > 0 && (
          <span className="absolute top-1.5 left-1.5 text-[9px] font-bold text-gray-500 bg-gray-800/60 px-1.5 py-0.5 rounded-md">
            {floor}°
          </span>
        )}
      </div>

      {/* ── Info area ── */}
      <div className="px-2.5 pb-2.5">
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${statusDot} animate-pulse`} />
          <span className="text-[10px] font-semibold text-gray-400">{statusLabel}</span>
        </div>

        {occupied && bookingHolder ? (
          <div className="min-h-[28px]">
            <p className="text-[11px] text-gray-300 truncate leading-tight font-medium" title={bookingHolder}>
              {bookingHolder}
            </p>
            {(adultCount || childCount) && (
              <p className="text-[9px] text-gray-500 mt-0.5 flex items-center gap-0.5">
                <User className="w-2.5 h-2.5" />
                {adultCount || 0}{childCount ? ` +${childCount}` : ''}
              </p>
            )}
          </div>
        ) : (
          <div className="min-h-[28px] flex items-center">
            {!inMaintenance && (
              <span className={`text-[10px] italic ${isClean ? 'text-emerald-600' : 'text-amber-600'}`}>
                {isClean ? 'Pronto para hóspede' : 'Aguarda limpeza'}
              </span>
            )}
          </div>
        )}

        {/* Actions Slot */}
        {actions && <div className="mt-2 space-y-1">{actions}</div>}
      </div>
    </div>
  );
};
