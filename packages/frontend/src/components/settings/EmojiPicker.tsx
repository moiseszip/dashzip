import { lazy, Suspense, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Loader2, SmilePlus } from 'lucide-react';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';

// O seletor completo (todas as categorias, busca e recentes) só baixa quando abre.
const Picker = lazy(() => import('emoji-picker-react'));

const CATEGORIES = [
  { category: 'suggested', name: 'Recentes' },
  { category: 'smileys_people', name: 'Carinhas e pessoas' },
  { category: 'animals_nature', name: 'Animais e natureza' },
  { category: 'food_drink', name: 'Comida e bebida' },
  { category: 'travel_places', name: 'Viagens e lugares' },
  { category: 'activities', name: 'Atividades' },
  { category: 'objects', name: 'Objetos' },
  { category: 'symbols', name: 'Símbolos' },
  { category: 'flags', name: 'Bandeiras' },
] as const;

/** Botão com o emoji do painel; abre o seletor com todos os emojis e busca. */
export function EmojiPicker({ value, onChange, disabled, label }: {
  value: string | null | undefined;
  onChange: (emoji: string | null) => void;
  disabled?: boolean;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const { resolvedTheme } = useTheme();
  const pick = (emoji: string | null) => {
    onChange(emoji);
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={label}
          title="Trocar o emoji"
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-lg transition-colors hover:bg-foreground/5 disabled:opacity-50',
            !value && 'text-muted-foreground',
          )}
        >
          {value || <SmilePlus className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} collisionPadding={12} className="z-50 rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-lg">
          <Suspense fallback={<div className="flex h-[380px] w-[min(320px,calc(100vw-24px))] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}>
            <Picker
              onEmojiClick={(data) => pick(data.emoji)}
              theme={(resolvedTheme === 'dark' ? 'dark' : 'light') as never}
              emojiStyle={'native' as never}
              searchPlaceHolder="Buscar emoji"
              previewConfig={{ showPreview: false }}
              categories={CATEGORIES as never}
              skinTonesDisabled={false}
              lazyLoadEmojis
              width="min(320px, calc(100vw - 24px))"
              height={380}
            />
          </Suspense>
          {value && (
            <button type="button" className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-foreground/5" onClick={() => pick(null)}>
              Tirar o emoji
            </button>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
