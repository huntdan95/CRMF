'use client';

import { NO_WETSUIT, NO_WETSUIT_LABEL, kidsSizeValue, wetsuitChoices, type WetsuitSizes } from '@/lib/site-settings';

/**
 * A wetsuit-size dropdown with Adult and Kids groups, built from the
 * stocked sizes in settings, and "No wetsuit (not swimming)" last for
 * someone riding along. The value is what's stored on the guest: an adult
 * size ("XL"), "Kids 8" or NO_WETSUIT. A value no longer stocked (Travis
 * dropped the size after they booked) is still shown, so editing doesn't
 * lose it.
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
  const stocked = wetsuitChoices(sizes);
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
      <option value={NO_WETSUIT}>{NO_WETSUIT_LABEL}</option>
    </select>
  );
}
