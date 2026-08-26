import { CaretDownIcon } from "@phosphor-icons/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./dropdown-menu.js";
import { cn } from "../../lib/utils.js";

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

export interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function Select({ value, onValueChange, options, placeholder = "Select", disabled, className }: SelectProps) {
  const selected = options.find((option) => option.value === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className={cn(
          "group flex w-full items-center justify-between gap-2 rounded-sm border border-line-strong bg-surface px-3 py-2 text-left text-sm text-ink outline-none transition-colors duration-150 hover:border-ink-faint focus-visible:border-accent data-[state=open]:border-accent disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        <span className={cn("truncate", !selected && "text-ink-faint")}>{selected?.label ?? placeholder}</span>
        <CaretDownIcon
          size={12}
          weight="bold"
          className="shrink-0 text-ink-faint transition-transform duration-150 ease-out group-data-[state=open]:rotate-180"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        sideOffset={4}
        className="max-h-72 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
      >
        <DropdownMenuRadioGroup value={value} onValueChange={onValueChange}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value} className="items-start">
              <span className="flex flex-col gap-0.5">
                <span>{option.label}</span>
                {option.hint ? <span className="text-caption text-ink-faint">{option.hint}</span> : null}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
