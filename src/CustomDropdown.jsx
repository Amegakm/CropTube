import React, { useState, useRef, useEffect, useCallback, useId } from 'react';
import { Check, ChevronDown } from 'lucide-react';

/**
 * CustomDropdown — fully accessible, keyboard-navigable, CropTube-branded.
 *
 * Props:
 *   value        {string}          – currently selected value
 *   onChange     {(val) => void}   – called when selection changes
 *   options      {Array}           – flat or grouped option list (see below)
 *   disabled     {boolean}
 *   aria-label   {string}
 *   id           {string}          – optional outer id
 *
 * Option shapes:
 *   Grouped:  { group: 'Group Label', items: [{ value, label }] }
 *   Flat:     { value, label }
 */
export default function CustomDropdown({
  value,
  onChange,
  options = [],
  disabled = false,
  'aria-label': ariaLabel,
  id: externalId,
}) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef(null);
  const menuRef = useRef(null);
  const uid = useId();
  const triggerId = externalId || `dropdown-trigger-${uid}`;
  const menuId = `dropdown-menu-${uid}`;

  // ── Flatten option list to get a linear index for keyboard nav ──────────
  const flatOptions = [];
  for (const opt of options) {
    if (opt.group) {
      for (const item of opt.items) flatOptions.push(item);
    } else {
      flatOptions.push(opt);
    }
  }

  // ── Find display label for current value ─────────────────────────────────
  const selectedLabel = flatOptions.find(o => o.value === value)?.label ?? value;

  // ── Close on outside click ───────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setFocusedIndex(-1);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // ── Scroll focused item into view ────────────────────────────────────────
  useEffect(() => {
    if (!open || focusedIndex < 0 || !menuRef.current) return;
    const items = menuRef.current.querySelectorAll('[role="option"]');
    if (items[focusedIndex]) {
      items[focusedIndex].scrollIntoView({ block: 'nearest' });
    }
  }, [focusedIndex, open]);

  // ── Keyboard handler ─────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e) => {
    if (disabled) return;
    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (!open) {
          setOpen(true);
          // Start focus on the currently selected item
          const idx = flatOptions.findIndex(o => o.value === value);
          setFocusedIndex(idx >= 0 ? idx : 0);
        } else {
          if (focusedIndex >= 0 && flatOptions[focusedIndex]) {
            onChange(flatOptions[focusedIndex].value);
            setOpen(false);
            setFocusedIndex(-1);
          }
        }
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (!open) {
          setOpen(true);
          setFocusedIndex(0);
        } else {
          setFocusedIndex(i => Math.min(i + 1, flatOptions.length - 1));
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!open) {
          setOpen(true);
          setFocusedIndex(flatOptions.length - 1);
        } else {
          setFocusedIndex(i => Math.max(i - 1, 0));
        }
        break;
      case 'Escape':
        if (open) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          setFocusedIndex(-1);
          containerRef.current?.querySelector('[role="combobox"]')?.focus();
        }
        break;
      case 'Tab':
        // Let tab pass through but close the menu
        if (open) {
          setOpen(false);
          setFocusedIndex(-1);
        }
        break;
      default:
        break;
    }
  }, [disabled, open, focusedIndex, flatOptions, onChange, value]);

  const toggleOpen = () => {
    if (disabled) return;
    const next = !open;
    setOpen(next);
    if (next) {
      const idx = flatOptions.findIndex(o => o.value === value);
      setFocusedIndex(idx >= 0 ? idx : 0);
    } else {
      setFocusedIndex(-1);
    }
  };

  const selectOption = (val) => {
    onChange(val);
    setOpen(false);
    setFocusedIndex(-1);
    containerRef.current?.querySelector('[role="combobox"]')?.focus();
  };

  // ── Render ───────────────────────────────────────────────────────────────
  let flatIdx = -1; // running counter to map rendered options to flatOptions indices

  return (
    <div
      ref={containerRef}
      className="relative w-full"
      onKeyDown={handleKeyDown}
    >
      {/* Trigger button */}
      <button
        id={triggerId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={ariaLabel}
        aria-disabled={disabled}
        disabled={disabled}
        onClick={toggleOpen}
        className={[
          'custom-dropdown-trigger w-full flex items-center justify-between',
          'bg-luxury-black/40 border rounded-xl outline-none',
          'text-xs text-luxury-cream/90 py-3 px-3 cursor-pointer select-none',
          'transition-all duration-200',
          open
            ? 'border-luxury-gold/100 ring-1 ring-luxury-gold/30'
            : 'border-luxury-cream/10 hover:border-luxury-chocolate',
          disabled ? 'opacity-50 cursor-not-allowed' : '',
          'focus-visible:ring-2 focus-visible:ring-luxury-gold/60 focus-visible:border-luxury-gold/100',
        ].filter(Boolean).join(' ')}
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown
          className={[
            'w-3.5 h-3.5 text-luxury-cream/50 flex-shrink-0 ml-2',
            'transition-transform duration-200',
            open ? 'rotate-180' : '',
          ].join(' ')}
        />
      </button>

      {/* Dropdown menu — rendered outside spotlight overflow:hidden via absolute positioning */}
      {open && (
        <ul
          ref={menuRef}
          id={menuId}
          role="listbox"
          aria-label={ariaLabel}
          className="custom-dropdown-menu absolute left-0 right-0 z-[200] mt-1.5
            bg-luxury-black border border-luxury-cream/10 rounded-xl shadow-2xl
            max-h-52 overflow-y-auto
            py-1
            animate-dropdown-in"
        >
          {options.map((opt, groupIdx) => {
            if (opt.group) {
              return (
                <React.Fragment key={`group-${groupIdx}`}>
                  <li
                    role="presentation"
                    className="px-3 pt-2.5 pb-1 text-[9px] font-bold uppercase tracking-widest text-luxury-sand select-none"
                  >
                    {opt.group}
                  </li>
                  {opt.items.map((item) => {
                    flatIdx++;
                    const idx = flatIdx;
                    const isSelected = item.value === value;
                    const isFocused = focusedIndex === idx;
                    return (
                      <li
                        key={item.value}
                        id={`${menuId}-opt-${idx}`}
                        role="option"
                        aria-selected={isSelected}
                        tabIndex={-1}
                        onMouseDown={(e) => { e.preventDefault(); selectOption(item.value); }}
                        onMouseEnter={() => setFocusedIndex(idx)}
                        className={[
                          'flex items-center justify-between px-3 py-2 mx-1 rounded-lg text-xs cursor-pointer select-none',
                          'transition-colors duration-100',
                          isSelected
                            ? 'bg-luxury-gold/20 text-luxury-gold/50'
                            : isFocused
                              ? 'bg-luxury-card/80 text-luxury-cream'
                              : 'text-luxury-cream/70 hover:bg-luxury-black/80 hover:text-luxury-cream',
                        ].join(' ')}
                      >
                        <span>{item.label}</span>
                        {isSelected && (
                          <Check className="w-3 h-3 text-luxury-gold flex-shrink-0" />
                        )}
                      </li>
                    );
                  })}
                </React.Fragment>
              );
            } else {
              // Flat option
              flatIdx++;
              const idx = flatIdx;
              const isSelected = opt.value === value;
              const isFocused = focusedIndex === idx;
              return (
                <li
                  key={opt.value}
                  id={`${menuId}-opt-${idx}`}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={-1}
                  onMouseDown={(e) => { e.preventDefault(); selectOption(opt.value); }}
                  onMouseEnter={() => setFocusedIndex(idx)}
                  className={[
                    'flex items-center justify-between px-3 py-2 mx-1 rounded-lg text-xs cursor-pointer select-none',
                    'transition-colors duration-100',
                    isSelected
                      ? 'bg-luxury-gold/20 text-luxury-gold/50'
                      : isFocused
                        ? 'bg-luxury-card/80 text-luxury-cream'
                        : 'text-luxury-cream/70 hover:bg-luxury-black/80 hover:text-luxury-cream',
                  ].join(' ')}
                >
                  <span>{opt.label}</span>
                  {isSelected && (
                    <Check className="w-3 h-3 text-luxury-gold flex-shrink-0" />
                  )}
                </li>
              );
            }
          })}
        </ul>
      )}
    </div>
  );
}
