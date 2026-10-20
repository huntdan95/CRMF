'use client';

import { kidsSizeValue, type WetsuitSizes } from '@/lib/site-settings';

/**
 * A wetsuit-size dropdown with Adult and Kids groups, built from the
 * stocked sizes in settings. The value is what's stored on the guest: an
 * adult size ("XL") or "Kids 8". A value no longer stocked (Travis dropped
 * the size after they booked) is still shown, so editing doesn't lose it.
 */
export function WetsuitSelect({
  id,
  sizes,
  value,
  onChange,
  className,
  placeholder = 'Pick a size',
  ...aria
}: {
  id?: string;
  sizes: WetsuitSizes;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  'aria-label'?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}) {
  const stocked = [...sizes.adult, ...sizes.kids.map(kidsSizeValue)];
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={className} {...aria}>
      <option value="">{placeholder}</option>
      {value && !stocked.includes(value) && <option value={value}>{value}</option>}
      <optgroup label="Adult">
        {sizes.adult.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </optgroup>
      <optgroup label="Kids">
        {sizes.kids.map((s) => (
          <option key={s} value={kidsSizeValue(s)}>
            {kidsSizeValue(s)}
          </option>
        ))}
      </optgroup>
    </select>
  );
}
