import type { ChatMessage } from '../llm/types';
import type { MachineScope } from './retriever';

/** 仅使用用户的话检索，避免助手推测反过来成为证据。 */
export function buildRetrievalContext(history: ChatMessage[], selected: MachineScope) {
  const users = history.filter(m => m.role === 'user').slice(-6);
  const reset = users.findLastIndex(m => /换个问题|新问题|另一台|换一台/.test(m.content));
  const relevant = reset >= 0 ? users.slice(reset) : users;
  const query = relevant.map(m => m.content).join('\n');
  const brands = [...new Set(query.match(/约翰迪尔|东方红|雷沃|久保田|中联/g) || [])];
  const models = [...new Set([...query.matchAll(/(?:型号\s*(?:是|为|[:：])?\s*)([A-Za-z0-9][A-Za-z0-9-]*)|\b(9R)\b/gi)].map(m => (m[1] || m[2]).toUpperCase()))];
  const brand = selected.brand?.trim() || brands.at(-1);
  const model = selected.model?.trim() || models.at(-1);
  const normalize = (v: string) => v.toUpperCase().replace(/[\s-]/g, '');
  const conflict = brands.length > 1 || models.length > 1 ||
    Boolean(selected.brand && brands.some(b => b !== selected.brand?.trim())) ||
    Boolean(selected.model && models.some(m => normalize(m) !== normalize(selected.model!)));
  return { query, machineType: selected.machineType?.trim(), brand, model, conflict };
}
