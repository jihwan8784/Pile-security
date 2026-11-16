import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

// 여러 className을 합치고, Tailwind 클래스끼리 겹치면 뒤쪽 것을 남긴다.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
