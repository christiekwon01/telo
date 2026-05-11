import type { AthleteContext, RovaTemplate } from '@/services/rovaTemplates';
import { rovaTemplates } from '@/services/rovaTemplates';

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesKeyword(haystack: string, keyword: string) {
  const k = normalizeText(keyword);
  if (!k) return false;
  return haystack.includes(k);
}

function templateMatchScore(template: RovaTemplate, normalizedMessage: string): number | null {
  const allOf = template.allOf ?? [];
  const allMatched = allOf.every((kw) => includesKeyword(normalizedMessage, kw));
  if (!allMatched) return null;

  const anyMatches = template.anyOf.filter((kw) => includesKeyword(normalizedMessage, kw));
  if (anyMatches.length === 0) return null;

  // Prefer templates with more specific keyword sets.
  return allOf.length + anyMatches.length;
}

export function matchTemplate(message: string, athleteContext: AthleteContext): string | null {
  const normalizedMessage = normalizeText(message);
  if (!normalizedMessage) return null;

  // Injury always wins, regardless of specificity.
  const injuryTemplate = rovaTemplates.find((t) => t.category === 'injury');
  if (injuryTemplate && templateMatchScore(injuryTemplate, normalizedMessage) != null) {
    return injuryTemplate.response(athleteContext);
  }

  let bestTemplate: RovaTemplate | null = null;
  let bestScore = -1;
  for (const template of rovaTemplates) {
    if (template.category === 'injury') continue;
    const score = templateMatchScore(template, normalizedMessage);
    if (score == null) continue;

    // Tie should keep first match in declaration order.
    if (score > bestScore) {
      bestTemplate = template;
      bestScore = score;
    }
  }

  return bestTemplate ? bestTemplate.response(athleteContext) : null;
}
