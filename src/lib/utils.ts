import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://edmneg.com';
export const GA_ID = process.env.NEXT_PUBLIC_GA_ID || '';
export const CLARITY_ID = process.env.NEXT_PUBLIC_CLARITY_ID || '';
export const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID || '';
