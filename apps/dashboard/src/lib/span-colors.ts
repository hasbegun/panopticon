/** Color mapping for span types — used in waterfall bars and badges */

export const SPAN_TYPE_COLORS: Record<string, { bg: string; border: string; text: string; bar: string }> = {
  agent_step:    { bg: 'bg-blue-500/10',    border: 'border-blue-500/20',    text: 'text-blue-400',    bar: 'bg-blue-500' },
  llm_call:      { bg: 'bg-purple-500/10',  border: 'border-purple-500/20',  text: 'text-purple-400',  bar: 'bg-purple-500' },
  mcp_request:   { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-400', bar: 'bg-emerald-500' },
  tool_call:     { bg: 'bg-orange-500/10',  border: 'border-orange-500/20',  text: 'text-orange-400',  bar: 'bg-orange-500' },
  resource_read: { bg: 'bg-cyan-500/10',    border: 'border-cyan-500/20',    text: 'text-cyan-400',    bar: 'bg-cyan-500' },
};

export function getSpanColor(spanType: string) {
  return SPAN_TYPE_COLORS[spanType] ?? SPAN_TYPE_COLORS.agent_step;
}
