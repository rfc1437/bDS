export function normalizeTaxonomyTerm(term: string): string {
  return term.trim().toLowerCase();
}

export function normalizeNonEmptyTaxonomyTerm(term: string): string | null {
  const normalized = normalizeTaxonomyTerm(term);
  return normalized ? normalized : null;
}

export function collectNormalizedTermsFromJsonValues(
  values: Array<string | null | undefined>,
): string[] {
  const terms = new Set<string>();

  for (const value of values) {
    if (!value) {
      continue;
    }

    try {
      const parsed = JSON.parse(value) as unknown;
      if (!Array.isArray(parsed)) {
        continue;
      }

      for (const entry of parsed) {
        if (typeof entry !== 'string') {
          continue;
        }

        const normalized = normalizeNonEmptyTaxonomyTerm(entry);
        if (normalized) {
          terms.add(normalized);
        }
      }
    } catch {
      // Invalid JSON: skip
    }
  }

  return Array.from(terms).sort();
}
