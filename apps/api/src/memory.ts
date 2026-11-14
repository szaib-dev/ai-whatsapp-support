export function explicitName(text: string): string | null {
  const match = text.replace(/\s+/g, ' ').match(/(?:\bmy name is\b|\bmera naam\b|\bcall me\b)\s+([\p{L}][\p{L}'’-]{0,29}(?:\s+[\p{L}][\p{L}'’-]{0,29}){0,2})/iu);
  if (!match) return null;
  const words = match[1].split(' ');
  const stop = words.findIndex(w => /^(and|i|is|hai|please|but|want|need|can)$/i.test(w));
  const name = (stop >= 0 ? words.slice(0,stop) : words).join(' ').trim();
  return name && !/^(ignore|system|admin|assistant|doctor|instructions)$/i.test(name) ? name : null;
}
export function rememberedName(memories: {content:string;kind?:string}[]): string | null {
  const value = memories.find(m=>m.kind==='preferred_name')?.content;
  if (!value) return null;
  try { const name = JSON.parse(value).name; return typeof name==='string' && /^[\p{L}][\p{L}'’ -]{0,90}$/u.test(name) ? name : null; } catch { return null; }
}
