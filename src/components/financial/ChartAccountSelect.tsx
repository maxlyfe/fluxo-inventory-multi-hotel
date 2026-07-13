import React, { useEffect, useState } from 'react';
import { chartOfAccountsService, ChartAccountGroup } from '../../lib/chartOfAccountsService';

interface Props {
  hotelId: string;
  value: string | null | undefined;
  onChange: (subId: string | null) => void;
  className?: string;
  placeholder?: string;
}

/** Grouped <select> of chart_of_accounts_sub (categoria → subcategoria). */
export default function ChartAccountSelect({ hotelId, value, onChange, className, placeholder }: Props) {
  const [groups, setGroups] = useState<ChartAccountGroup[]>([]);

  useEffect(() => {
    chartOfAccountsService.listGrouped(hotelId).then(setGroups).catch(() => {});
  }, [hotelId]);

  return (
    <select
      className={className ?? 'input-field'}
      value={value ?? ''}
      onChange={e => onChange(e.target.value || null)}
    >
      <option value="">{placeholder ?? 'Sem plano de contas'}</option>
      {groups.map(g => (
        <optgroup key={g.id} label={g.name}>
          {g.subs.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
