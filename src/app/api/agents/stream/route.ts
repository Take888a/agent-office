import { getOfficeState, subscribe } from "@/lib/office";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let sending = false;
      const send = async () => {
        if (sending) return;
        sending = true;
        try {
          const officeState = await getOfficeState();
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(officeState)}\n\n`),
          );
        } catch {
          // クライアント切断後は無視
        } finally {
          sending = false;
        }
      };

      const unsubscribe = subscribe(() => void send());
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          // ignore
        }
      }, 15000);
      void send();

      req.signal.addEventListener("abort", () => {
        unsubscribe();
        clearInterval(keepalive);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
