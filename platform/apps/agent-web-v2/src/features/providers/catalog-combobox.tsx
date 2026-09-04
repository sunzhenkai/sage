import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Catalog combobox (spec §8.3): a search input with a listbox of catalog
 * results. Keyboard semantics: ArrowDown/ArrowUp move the active option,
 * Enter selects it, Escape closes the list. Selecting an item calls
 * `onSelect` and closes the list without touching the search query.
 */
export function CatalogCombobox<T>({
  label,
  placeholder,
  emptyText,
  disabled = false,
  query,
  onQueryChange,
  items,
  loading,
  loadingMore,
  hasMore,
  onLoadMore,
  keyOf,
  labelOf,
  onSelect,
  focusSignal,
}: {
  label: string;
  placeholder: string;
  emptyText: string;
  disabled?: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  items: readonly T[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  keyOf: (item: T) => string;
  labelOf: (item: T) => string;
  onSelect: (item: T) => void;
  /** Bump to focus the input and open the list (e.g. after provider select). */
  focusSignal?: number;
}) {
  const { t } = useI18n();
  const id = useId();
  const listboxId = `${id}-listbox`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    if (focusSignal !== undefined && focusSignal > 0 && !disabled) {
      inputRef.current?.focus();
      setOpen(true);
    }
  }, [focusSignal, disabled]);

  useEffect(() => {
    setActiveIndex(items.length > 0 ? 0 : -1);
  }, [items.length]);

  const selectItem = (item: T) => {
    onSelect(item);
    setOpen(false);
    setActiveIndex(-1);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(items.length > 0 ? 0 : -1);
        return;
      }
      setActiveIndex((index) => (items.length === 0 ? -1 : Math.min(index + 1, items.length - 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (items.length === 0 ? -1 : Math.max(index - 1, 0)));
    } else if (event.key === "Enter") {
      if (open && activeIndex >= 0 && activeIndex < items.length) {
        event.preventDefault();
        selectItem(items[activeIndex] as T);
      }
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        setActiveIndex(-1);
      }
    }
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
          aria-autocomplete="list"
          disabled={disabled}
          value={query}
          placeholder={placeholder}
          onChange={(event) => {
            onQueryChange(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
      </div>
      {open && !disabled ? (
        <div className="rounded-md border bg-popover text-popover-foreground shadow-md">
          {loading ? (
            <div role="status" className="px-3 py-2 text-sm text-muted-foreground">
              {t("common.loading")}
            </div>
          ) : items.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">{emptyText}</div>
          ) : (
            <ul role="listbox" id={listboxId} aria-label={label} className="max-h-56 overflow-y-auto p-1">
              {items.map((item, index) => (
                <li
                  key={keyOf(item)}
                  id={`${id}-option-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={cn(
                    "cursor-pointer rounded-sm px-2 py-1.5 text-sm",
                    index === activeIndex && "bg-accent text-accent-foreground",
                  )}
                  onMouseDown={(event) => {
                    // Keep input focus; selection happens on mouseup/click.
                    event.preventDefault();
                  }}
                  onClick={() => selectItem(item)}
                >
                  {labelOf(item)}
                </li>
              ))}
            </ul>
          )}
          {hasMore ? (
            <button
              type="button"
              disabled={loadingMore}
              onClick={onLoadMore}
              className="w-full border-t px-3 py-1.5 text-left text-xs font-medium text-muted-foreground hover:bg-accent cursor-pointer disabled:opacity-50"
            >
              {loadingMore ? t("common.loadingMore") : t("common.loadMore")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
