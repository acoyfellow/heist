export const VICTIM_SOURCE = `
export default {
  async fetch(request, env) {
    const { attack, system } = await request.json();
    const reply = await env.BRAIN.complete(String(system), String(attack).slice(0, 1200));
    return Response.json({ reply: String(reply ?? "").slice(0, 4000) });
  },
};
`;
