/**
 * DAS Boardroom kit — lobby variant picker: the variants grouped by family as radio cards (icon,
 * title, one-line tagline), plus the chosen variant's rules card. Games pass their own variant table
 * and icons; the room validates the choice. Read-only when the viewer can't edit (or in a tournament).
 */
import type { CSSProperties, ReactNode } from 'react';
import { PixelIcon, cx, handleRovingKeys, rovingTabIndex } from '@dascade/ui';

export interface BoardVariantOption<V extends string = string> {
  id: V;
  title: string;
  tagline: string;
  /** Family id (see `families`). */
  family: string;
  /** Small drawing shown on the card. */
  icon?: ReactNode;
}

export interface VariantPickerProps<V extends string = string> {
  value: V;
  options: readonly BoardVariantOption<V>[];
  /** Groups in display order; options of a family missing here aren't shown. */
  families: readonly { id: string; label: string }[];
  canEdit: boolean;
  onChange: (id: V) => void;
  /** The featured (default) variant gets a wider card. */
  feature?: V;
  label?: string;
  className?: string;
}

export function VariantPicker<V extends string>({
  value,
  options,
  families,
  canEdit,
  onChange,
  feature,
  label = 'Variant',
  className,
}: VariantPickerProps<V>) {
  return (
    <div className={cx('dc-field', 'br-variant-picker', className)}>
      <span className="dc-field__label">{label}</span>
      {families.map((family) => {
        const group = options.filter((o) => o.family === family.id);
        if (group.length === 0) return null;
        const holdsValue = group.some((o) => o.id === value);
        return (
          <div key={family.id} className="br-variants__group">
            <span className="br-variants__family">{family.label}</span>
            <div
              className="br-variants"
              role="radiogroup"
              aria-label={`${family.label} variants`}
              onKeyDown={(e) => handleRovingKeys(e, 'radio')}
            >
              {group.map((o, i) => {
                const on = value === o.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    tabIndex={rovingTabIndex(on, i, holdsValue)}
                    className={cx('br-variant', on && 'is-on', o.id === feature && 'br-variant--feature')}
                    disabled={!canEdit}
                    data-variant={o.id}
                    onClick={() => onChange(o.id)}
                    style={{ '--i': i } as CSSProperties}
                  >
                    {o.icon}
                    <span className="br-variant__text">
                      <span className="br-variant__title">{o.title}</span>
                      <span className="br-variant__tag">{o.tagline}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The rules of the chosen variant, as a short list. */
export function VariantRulesCard({ title, rules, className }: { title: string; rules: readonly string[]; className?: string }) {
  return (
    <section className={cx('br-rules-card', className)} aria-label={`${title} rules`}>
      <h3 className="br-rules-card__title">
        <PixelIcon name="info" /> {title} rules
      </h3>
      <ul className="br-rules-card__list">
        {rules.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </section>
  );
}
