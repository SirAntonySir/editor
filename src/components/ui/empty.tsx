function Empty({ className = '', ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-6 rounded-lg p-6 text-center text-balance md:p-12 ${className}`}
      {...props}
    />
  );
}

function EmptyHeader({ className = '', ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={`flex max-w-sm flex-col items-center gap-2 text-center ${className}`}
      {...props}
    />
  );
}

function EmptyMedia({
  className = '',
  variant = 'default',
  ...props
}: React.ComponentProps<'div'> & { variant?: 'default' | 'icon' }) {
  const variantClass =
    variant === 'icon'
      ? 'flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-secondary text-text-primary [&_svg:not([class*="size-"])]:size-6'
      : 'bg-transparent';

  return (
    <div
      className={`mb-2 flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0 ${variantClass} ${className}`}
      {...props}
    />
  );
}

function EmptyTitle({ className = '', ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={`text-lg font-medium tracking-tight text-text-primary ${className}`}
      {...props}
    />
  );
}

function EmptyDescription({ className = '', ...props }: React.ComponentProps<'p'>) {
  return (
    <div
      className={`text-sm text-text-secondary ${className}`}
      {...props}
    />
  );
}

function EmptyContent({ className = '', ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={`flex w-full max-w-sm min-w-0 flex-col items-center gap-4 text-sm text-balance ${className}`}
      {...props}
    />
  );
}

export {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
};
