'use client';

import React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

type Variant = 'neutral' | 'primary' | 'accent' | 'danger' | 'quiet';
type Size = 'sm' | 'md' | 'lg';

interface BaseProps {
  variant?: Variant;
  size?: Size;
  busy?: boolean;
  className?: string;
  children?: React.ReactNode;
}

type ButtonProps = BaseProps & React.ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };
type LinkProps = BaseProps & { href: string; target?: string; rel?: string };

const classes = (variant: Variant, size: Size, className?: string) =>
  cn(
    'btn',
    variant === 'primary' && 'btn-primary',
    variant === 'accent' && 'btn-accent',
    variant === 'danger' && 'btn-danger',
    variant === 'quiet' && 'btn-quiet',
    size === 'sm' && 'btn-sm',
    size === 'lg' && 'btn-lg',
    className,
  );

export default function Button(props: ButtonProps | LinkProps) {
  const { variant = 'neutral', size = 'md', className, children } = props;
  if ('href' in props && props.href) {
    const { href, target, rel } = props;
    return (
      <Link href={href} target={target} rel={rel} className={classes(variant, size, className)}>
        {children}
      </Link>
    );
  }
  const { busy, disabled, type = 'button', ...rest } = props as ButtonProps;
  return (
    <button type={type} className={classes(variant, size, className)} disabled={disabled || busy} {...rest}>
      {busy ? 'Working…' : children}
    </button>
  );
}
