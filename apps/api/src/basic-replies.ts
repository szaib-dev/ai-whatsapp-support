// No business facts are generated here. Detailed factual answers use published knowledge.
export const basicReplies = {
  greeting: "Hello! How can I help you today?",
  wellbeing: "I'm here and ready to help! How are you doing?",
  thanks: "You're welcome! Is there anything else I can help with?",
  goodbye: "Take care! Feel free to message again whenever you need help.",
  identity: "I'm an automated assistant. I can chat and help collect your questions or requests.",
  appointment: "I can help you put together an appointment request. Which date and time would you prefer? A request is not a confirmed booking.",
  pricing: "I don't have confirmed prices yet. Which service are you asking about?",
  services: "I don't have the confirmed service details yet. What are you interested in?",
  hours: "I don't have confirmed opening hours or location details yet. What would you like to know?",
  medical: "I can't assess symptoms or recommend a treatment. Please discuss medical questions with a qualified clinician.",
  other: "",
  unavailable: "",
};
export type BasicIntent = keyof typeof basicReplies;
export function localIntent(text: string): BasicIntent {
  if (/\b(diagnos|prescri|emergency|chest pain|bleeding|suicid|symptom)/i.test(text)) return "medical";
  if (/\b(price|pricing|cost|fee|charges|kitne|qeemat)\b/i.test(text)) return "pricing";
  if (/\b(appointment|book|booking)\b/i.test(text)) return "appointment";
  if (/\b(service|services|treatment)\b/i.test(text)) return "services";
  if (/\b(hours|open|opened|opening|close|closed|closing|timing|khulta|band|address|location)\b/i.test(text)) return "hours";
  if (/how are you|kaise ho|kese ho/i.test(text)) return "wellbeing";
  if (/\b(thanks|thank you|shukriya)\b/i.test(text)) return "thanks";
  if (/\b(bye|goodbye)\b/i.test(text)) return "goodbye";
  if (/who are you|are you.*(bot|human)/i.test(text)) return "identity";
  if (/^(hi|hello|hey|salam|assalam|aoa)\b/i.test(text.trim())) return "greeting";
  return "other";
}
