import { cn } from '@/lib/utils';

export const APP_NAME = 'dash.zip';

const SIZES = {
  sm: { box: 'h-7 w-7 rounded-md', text: 'text-sm' },
  md: { box: 'h-8 w-8 rounded-lg', text: 'text-base' },
  lg: { box: 'h-12 w-12 rounded-xl', text: 'text-xl' },
};

interface LogoProps {
  size?: keyof typeof SIZES;
  showText?: boolean;
  className?: string;
}

export function Logo({ size = 'md', showText = true, className }: LogoProps) {
  const s = SIZES[size];
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <img src="/favicon.svg" alt={showText ? '' : APP_NAME} className={cn('shrink-0', s.box)} />
      {showText && <span className={cn('font-semibold tracking-tight text-foreground', s.text)}>{APP_NAME}</span>}
    </div>
  );
}
