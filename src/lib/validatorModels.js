export const AI_MODELS = [
  { id: 'claude-3-5-sonnet', name: 'Claude 3.5',    provider: 'Anthropic', color: '#8b5cf6', accent: '#6d28d9', icon: '◈', gradR: 139, gradG: 92,  gradB: 246 },
  { id: 'gpt-4o',            name: 'GPT-4o',         provider: 'OpenAI',    color: '#10b981', accent: '#059669', icon: '⬡', gradR: 16,  gradG: 185, gradB: 129 },
  { id: 'gemini-1.5-pro',   name: 'Gemini 1.5',     provider: 'Google',    color: '#3b82f6', accent: '#2563eb', icon: '◆', gradR: 59,  gradG: 130, gradB: 246 },
  { id: 'mistral-large',     name: 'Mistral Large',  provider: 'Mistral',   color: '#f97316', accent: '#ea580c', icon: '⬟', gradR: 249, gradG: 115, gradB: 22  },
  { id: 'llama-3-70b',       name: 'Llama 3 70B',    provider: 'Meta',      color: '#ef4444', accent: '#dc2626', icon: '▲', gradR: 239, gradG: 68,  gradB: 68  },
];

export function addressToModel(address) {
  if (!address) return AI_MODELS[0];
  const hash = parseInt(address.slice(-4), 16);
  return AI_MODELS[hash % AI_MODELS.length];
}

export function getDominantModel(validators) {
  if (!validators || validators.length === 0) return AI_MODELS[0];
  const counts = {};
  validators.forEach(v => {
    const m = v.model || addressToModel(v.address);
    counts[m.id] = (counts[m.id] || 0) + 1;
  });
  const dominantId = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
  return AI_MODELS.find(m => m.id === dominantId) || AI_MODELS[0];
}
