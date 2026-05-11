/**
 * Temporary global switch: archive Anthropic-based prompts.
 * Set to true when Anthropic prompts should be re-enabled.
 */
export const ANTHROPIC_PROMPTS_ENABLED = false;

export function isAnthropicEnabled() {
  return ANTHROPIC_PROMPTS_ENABLED;
}
