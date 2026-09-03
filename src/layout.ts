export type PageMode = "auto" | "single" | "double";

export interface BookGeometry {
  pageCount: 1 | 2;
  pageWidth: number;
  stageWidth: number;
  pageStride: number;
}

export function calculateBookGeometry(
  viewportWidth: number,
  gap: number,
  pageMode: PageMode,
  maxPageWidth: number,
  desktop: boolean,
): BookGeometry {
  const safeViewport = Math.max(1, viewportWidth);
  const safeGap = Math.max(0, gap);
  const available = Math.max(120, safeViewport - 48);

  let pageCount: 1 | 2 = 1;
  if (pageMode === "double" || (pageMode === "auto" && desktop && safeViewport >= 820)) {
    pageCount = 2;
  }

  let pageWidth = (available - safeGap * (pageCount - 1)) / pageCount;
  if (pageCount === 2 && pageWidth < 260) {
    pageCount = 1;
    pageWidth = available;
  }

  if (maxPageWidth > 0) pageWidth = Math.min(pageWidth, maxPageWidth);
  pageWidth = Math.max(120, pageWidth);

  const stageWidth = pageCount * pageWidth + safeGap * (pageCount - 1);
  return {
    pageCount,
    pageWidth,
    stageWidth,
    pageStride: stageWidth + safeGap,
  };
}

export function calculateTotalPages(scrollWidth: number, pageStride: number, gap: number): number {
  if (pageStride <= 0) return 1;
  return Math.max(1, Math.round((Math.max(0, scrollWidth) + Math.max(0, gap)) / pageStride));
}

export function clampPage(page: number, totalPages: number): number {
  if (!Number.isFinite(page)) return 0;
  return Math.max(0, Math.min(Math.max(1, totalPages) - 1, Math.round(page)));
}

export function fractionFromPage(page: number, totalPages: number): number {
  if (totalPages <= 1) return 0;
  return clampPage(page, totalPages) / (totalPages - 1);
}

export function pageFromFraction(fraction: number, totalPages: number): number {
  const safeFraction = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
  return clampPage(safeFraction * Math.max(0, totalPages - 1), totalPages);
}
