export function chatLink(phone: string, message?: string | null): string {
  const digits = phone.replace(/\D/g, '');
  const base = `https://wa.me/${digits}`;
  return message && message.trim() ? `${base}?text=${encodeURIComponent(message.trim())}` : base;
}
