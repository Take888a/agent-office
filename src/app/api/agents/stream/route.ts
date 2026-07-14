import { listEmployees, subscribe } from "@/lib/office";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = () => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(listEmployees())}\n\n`),
          );
        } catch {
          // クライアント切断後は無視
        }
      };

      const unsubscribe = subscribe(send);
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          // ignore
        }
      }, 15000);
      send();

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
