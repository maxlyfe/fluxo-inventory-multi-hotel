import { describe, it, expect } from 'vitest';
import { getPatternForWeek, formatEntry, getEntryStyle } from './scheduleHelpers';
import type { ScheduleEntry, Hotel, OccurrenceType } from './scheduleHelpers';

// ---------------------------------------------------------------------------
// getPatternForWeek
// ---------------------------------------------------------------------------
describe('getPatternForWeek', () => {
  it('12x36 com domingo trabalhando: alterna true/false a partir de true', () => {
    const result = getPatternForWeek('12x36', true, []);
    expect(result).toEqual([true, false, true, false, true, false, true, false]);
  });

  it('12x36 com domingo de folga: alterna false/true', () => {
    const result = getPatternForWeek('12x36', false, []);
    expect(result).toEqual([false, true, false, true, false, true, false, true]);
  });

  it('6x1 com folga no domingo (index 0): só index 0 é false', () => {
    const result = getPatternForWeek('6x1', true, [0]);
    expect(result).toEqual([false, true, true, true, true, true, true, true]);
  });

  it('5x2 com folga domingo e sábado (0 e 6)', () => {
    const result = getPatternForWeek('5x2', true, [0, 6]);
    expect(result).toEqual([false, true, true, true, true, true, false, true]);
  });

  it('sem folgas definidas: todos trabalham', () => {
    const result = getPatternForWeek('6x1', true, []);
    expect(result).toEqual([true, true, true, true, true, true, true, true]);
  });

  it('todos de folga: tudo false', () => {
    const result = getPatternForWeek('custom', false, [0, 1, 2, 3, 4, 5, 6, 7]);
    expect(result).toEqual([false, false, false, false, false, false, false, false]);
  });

  it('retorna array de 8 posições', () => {
    const result = getPatternForWeek('6x1', true, [0]);
    expect(result).toHaveLength(8);
  });
});

// ---------------------------------------------------------------------------
// formatEntry
// ---------------------------------------------------------------------------
describe('formatEntry', () => {
  const hotels: Hotel[] = [
    { id: 'h1', name: 'Hotel Central' },
    { id: 'h2', name: 'Hotel Praia Norte' },
  ];

  const makeEntry = (overrides: Partial<ScheduleEntry>): ScheduleEntry => ({
    schedule_id: 's1', employee_id: 'e1', sector: 'Recepção', day_date: '2026-03-20',
    entry_type: 'shift', shift_start: null, shift_end: null,
    custom_label: null, transfer_hotel_id: null, occurrence_type_id: null,
    ...overrides,
  });

  it('null retorna ------', () => {
    expect(formatEntry(null, hotels)).toEqual({ line1: '------' });
  });

  it('empty retorna ------', () => {
    expect(formatEntry(makeEntry({ entry_type: 'empty' }), hotels)).toEqual({ line1: '------' });
  });

  it('shift com horários formata corretamente', () => {
    const entry = makeEntry({ entry_type: 'shift', shift_start: '07:00:00', shift_end: '15:00:00' });
    expect(formatEntry(entry, hotels)).toEqual({ line1: '07:00 AS 15:00' });
  });

  it('shift sem horários retorna —', () => {
    const entry = makeEntry({ entry_type: 'shift' });
    expect(formatEntry(entry, hotels)).toEqual({ line1: '—' });
  });

  it('meia_dobra com horários', () => {
    const entry = makeEntry({ entry_type: 'meia_dobra', shift_start: '08:00:00', shift_end: '12:00:00' });
    expect(formatEntry(entry, hotels)).toEqual({ line1: 'MEIA DOBRA', line2: '(08:00 AS 12:00)' });
  });

  it('meia_dobra sem horários', () => {
    const entry = makeEntry({ entry_type: 'meia_dobra' });
    expect(formatEntry(entry, hotels)).toEqual({ line1: 'MEIA DOBRA', line2: undefined });
  });

  it('transfer mostra nome curto do hotel + horários', () => {
    const entry = makeEntry({
      entry_type: 'transfer', transfer_hotel_id: 'h2',
      shift_start: '09:00:00', shift_end: '17:00:00',
    });
    expect(formatEntry(entry, hotels)).toEqual({ line1: 'Hotel', line2: '09:00 AS 17:00' });
  });

  it('transfer sem hotel encontrado mostra "Outra"', () => {
    const entry = makeEntry({ entry_type: 'transfer', transfer_hotel_id: 'desconhecido' });
    expect(formatEntry(entry, hotels)).toEqual({ line1: 'Outra', line2: undefined });
  });

  it('tipos legados (folga, falta, etc.) retornam label correta', () => {
    expect(formatEntry(makeEntry({ entry_type: 'folga' }), hotels)).toEqual({ line1: 'FOLGA' });
    expect(formatEntry(makeEntry({ entry_type: 'falta' }), hotels)).toEqual({ line1: 'FALTA' });
    expect(formatEntry(makeEntry({ entry_type: 'ferias' }), hotels)).toEqual({ line1: 'FÉRIAS' });
    expect(formatEntry(makeEntry({ entry_type: 'atestado' }), hotels)).toEqual({ line1: 'ATESTADO' });
    expect(formatEntry(makeEntry({ entry_type: 'compensa' }), hotels)).toEqual({ line1: 'COMPENSA' });
    expect(formatEntry(makeEntry({ entry_type: 'curso' }), hotels)).toEqual({ line1: 'CURSO' });
    expect(formatEntry(makeEntry({ entry_type: 'inss' }), hotels)).toEqual({ line1: 'INSS' });
  });

  it('custom com label retorna a label', () => {
    const entry = makeEntry({ entry_type: 'custom', custom_label: 'Plantão' });
    expect(formatEntry(entry, hotels)).toEqual({ line1: 'Plantão' });
  });

  it('custom sem label retorna —', () => {
    const entry = makeEntry({ entry_type: 'custom' });
    expect(formatEntry(entry, hotels)).toEqual({ line1: '—' });
  });

  it('usa nome do occurrence_type do DB quando disponível', () => {
    const occTypes: OccurrenceType[] = [{
      id: 'ot1', hotel_id: 'h1', name: 'Falta Justificada', slug: 'falta_justificada',
      color: 'red', causes_basket_loss: true, loss_threshold: 1, is_system: false, sort_order: 1,
    }];
    const entry = makeEntry({ entry_type: 'custom', occurrence_type_id: 'ot1' });
    expect(formatEntry(entry, hotels, occTypes)).toEqual({ line1: 'Falta Justificada' });
  });
});

// ---------------------------------------------------------------------------
// getEntryStyle
// ---------------------------------------------------------------------------
describe('getEntryStyle', () => {
  const makeEntry = (overrides: Partial<ScheduleEntry>): ScheduleEntry => ({
    schedule_id: 's1', employee_id: 'e1', sector: 'Recepção', day_date: '2026-03-20',
    entry_type: 'shift', shift_start: null, shift_end: null,
    custom_label: null, transfer_hotel_id: null, occurrence_type_id: null,
    ...overrides,
  });

  it('null retorna cinza', () => {
    const style = getEntryStyle(null);
    expect(style.color).toContain('text-gray');
    expect(style.bg).toBe('');
  });

  it('empty retorna cinza', () => {
    const style = getEntryStyle(makeEntry({ entry_type: 'empty' }));
    expect(style.color).toContain('text-gray');
  });

  it('folga retorna verde', () => {
    const style = getEntryStyle(makeEntry({ entry_type: 'folga' }));
    expect(style.color).toContain('green');
    expect(style.bg).toContain('green');
  });

  it('falta retorna vermelho', () => {
    const style = getEntryStyle(makeEntry({ entry_type: 'falta' }));
    expect(style.color).toContain('red');
  });

  it('occurrence_type do DB usa cor do tipo', () => {
    const occTypes: OccurrenceType[] = [{
      id: 'ot1', hotel_id: 'h1', name: 'Custom', slug: 'custom',
      color: 'teal', causes_basket_loss: false, loss_threshold: 1, is_system: false, sort_order: 1,
    }];
    const entry = makeEntry({ entry_type: 'custom', occurrence_type_id: 'ot1' });
    const style = getEntryStyle(entry, occTypes);
    expect(style.color).toContain('teal');
    expect(style.bg).toContain('teal');
  });

  it('occurrence_type com cor desconhecida usa indigo como fallback', () => {
    const occTypes: OccurrenceType[] = [{
      id: 'ot1', hotel_id: 'h1', name: 'Custom', slug: 'custom',
      color: 'neon', causes_basket_loss: false, loss_threshold: 1, is_system: false, sort_order: 1,
    }];
    const entry = makeEntry({ entry_type: 'custom', occurrence_type_id: 'ot1' });
    const style = getEntryStyle(entry, occTypes);
    expect(style.color).toContain('indigo');
  });
});
